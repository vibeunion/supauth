import { describe, expect, test } from "bun:test";
import { decodeSchema, Type } from "@supauth/shared";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { AdminApiError } from "./admin-api.js";
import { executeAuthoritativeCommand } from "./authoritative-command.js";

const inputSchema = Type.Object({ id: Type.String({ minLength: 1 }), enabled: Type.Boolean() });
const acknowledgementSchema = Type.Object({ accepted: Type.Boolean() });
const authoritySchema = Type.Object({ id: Type.String({ minLength: 1 }), enabled: Type.Boolean() });
const input = { id: "target-a", enabled: true };
const acknowledgement = { accepted: true };
const authority = { ...input };

function decodeInput(value: unknown) {
  const decoded = decodeSchema(inputSchema, value);
  return { id: decoded.id, enabled: decoded.enabled };
}

const contract = {
  input: decodeInput,
  acknowledgement: (value: unknown) => decodeSchema(acknowledgementSchema, value),
  authority: (value: unknown) => decodeSchema(authoritySchema, value),
  matches: (original: ReturnType<typeof decodeInput>, observed: ReturnType<typeof decodeInput>) =>
    original.id === observed.id && original.enabled === observed.enabled,
};

function classifyWriteDenial(error: unknown): error is AdminApiError {
  return error instanceof AdminApiError && [401, 403].includes(error.statusCode);
}

function setup(
  write: (value: ReturnType<typeof decodeInput>) => Promise<unknown> = async () => acknowledgement,
  read: (value: ReturnType<typeof decodeInput>) => Promise<unknown> = async () => authority,
) {
  const calls = { write: 0, read: 0 };
  return {
    calls,
    transport: {
      write(value: ReturnType<typeof decodeInput>) { calls.write++; return write(value); },
      read(value: ReturnType<typeof decodeInput>) { calls.read++; return read(value); },
    },
  };
}

describe("shared authoritative command", () => {
  test("non-idempotent input transformation decodes once before one write and read", async () => {
    const requestSchema = Type.Object({
      params: Type.Object({ id: Type.String({ minLength: 1 }) }),
      body: Type.Object({ enabled: Type.Boolean() }),
    });
    const request = { params: { id: input.id }, body: { enabled: input.enabled } };
    const decoded = { input: 0, acknowledgement: 0, authority: 0, matches: 0 };
    const probe = setup(async (value) => {
      expect(value).toEqual(input);
      return acknowledgement;
    }, async (value) => {
      expect(value).toEqual(input);
      return authority;
    });
    const result = await executeAuthoritativeCommand(request, {
      ...contract,
      input(value: unknown) {
        decoded.input++;
        expect(value).toBe(request);
        const raw = decodeSchema(requestSchema, value);
        return { id: raw.params.id, enabled: raw.body.enabled };
      },
      acknowledgement(value: unknown) {
        decoded.acknowledgement++;
        return contract.acknowledgement(value);
      },
      authority(value: unknown) {
        decoded.authority++;
        return contract.authority(value);
      },
      matches(original, observed) {
        decoded.matches++;
        return contract.matches(original, observed);
      },
    }, probe.transport);
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") throw new Error("Expected transformed input to confirm");
    expect(result.authority).toEqual(authority);
    expect(result.acknowledgement).toEqual(acknowledgement);
    expect(result.writeError).toBeNull();
    expect(result.readError).toBeNull();
    expect(decoded).toEqual({ input: 1, acknowledgement: 1, authority: 1, matches: 1 });
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  test.each([false, true])("non-idempotent authority envelope decodes once; writeFailed=%s", async (writeFailed) => {
    const envelopeSchema = Type.Object({ data: Type.Array(authoritySchema) });
    const envelope = { data: [authority] };
    const writeError = new Error("Write outcome unknown");
    const decoded = { input: 0, acknowledgement: 0, authority: 0, matches: 0 };
    const probe = setup(async (value) => {
      expect(value).toEqual(input);
      if (writeFailed) throw writeError;
      return acknowledgement;
    }, async (value) => {
      expect(value).toEqual(input);
      return envelope;
    });
    const result = await executeAuthoritativeCommand(input, {
      input(value: unknown) {
        decoded.input++;
        return contract.input(value);
      },
      acknowledgement(value: unknown) {
        decoded.acknowledgement++;
        return contract.acknowledgement(value);
      },
      authority(value: unknown) {
        decoded.authority++;
        expect(value).toBe(envelope);
        return decodeSchema(envelopeSchema, value).data;
      },
      matches(original, observed) {
        decoded.matches++;
        return observed.length === 1 && observed.some((item) => contract.matches(original, item));
      },
    }, probe.transport);
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") throw new Error("Expected transformed authority to confirm");
    expect(result.authority).toEqual(envelope.data);
    expect(result.acknowledgement).toEqual(writeFailed ? null : acknowledgement);
    expect(result.writeError).toBe(writeFailed ? writeError : null);
    expect(result.readError).toBeNull();
    expect(decoded).toEqual({
      input: 1, acknowledgement: writeFailed ? 0 : 1, authority: 1, matches: 1,
    });
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  test("acknowledgement alone cannot settle before delayed authority", async () => {
    const pending = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
    const probe = setup(async (value) => {
      expect(value).toEqual(input);
      return acknowledgement;
    }, (value) => {
      expect(value).toEqual(input);
      started.resolve();
      return pending.promise;
    });
    let settled = false;
    const execution = executeAuthoritativeCommand(input, contract, probe.transport).then((result) => {
      settled = true;
      return result;
    });
    await started.promise;
    expect(settled).toBe(false);
    expect(probe.calls).toEqual({ write: 1, read: 1 });
    pending.resolve(authority);
    const result = await execution;
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") throw new Error("Expected confirmed authority");
    expect(result.authority).toEqual(authority);
    expect(result.acknowledgement).toEqual(acknowledgement);
    expect(result.writeError).toBeNull();
    expect(result.readError).toBeNull();
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  for (const code of [401, 403]) {
    test.each([true, false])(`write ${code} without classifier never denies; matches=%s`, async (matches) => {
      const error = new AdminApiError("Post-write failure", code);
      const observed = { ...authority, enabled: matches };
      const probe = setup(async () => { throw error; }, async () => observed);
      const result = await executeAuthoritativeCommand(input, contract, probe.transport);
      expect(result.kind).toBe(matches ? "confirmed" : "unknown");
      if (result.kind !== "confirmed" && result.kind !== "unknown") throw new Error("Expected readback");
      expect(result.writeError).toBe(error);
      expect(result.readError).toBeNull();
      expect(result.acknowledgement).toBeNull();
      expect(result.authority).toEqual(observed);
      expect(probe.calls).toEqual({ write: 1, read: 1 });
    });

    test.each([true, false])(`write ${code} with classifier denies; synchronous=%s`, async (synchronous) => {
      const error = new AdminApiError("Write denied", code);
      const classified: unknown[] = [];
      const probe = setup(() => {
        if (synchronous) throw error;
        return Promise.reject(error);
      });
      const result = await executeAuthoritativeCommand(input, {
        ...contract,
        isDefinitiveWriteFailure: (failure: unknown): failure is AdminApiError => {
          classified.push(failure);
          return classifyWriteDenial(failure);
        },
      }, probe.transport);
      expect(result).toEqual({ kind: "denied", error });
      expect(classified).toEqual([error]);
      expect(probe.calls).toEqual({ write: 1, read: 0 });
    });

    test.each([true, false])(`ack decoder ${code} must never invoke write classifier; matches=%s`, async (matches) => {
      const error = new AdminApiError("Acknowledgement decoder failure", code);
      const classified: unknown[] = [];
      const probe = setup(undefined, async () => ({ ...authority, enabled: matches }));
      const result = await executeAuthoritativeCommand(input, {
        ...contract,
        acknowledgement: (_value: unknown): ReturnType<typeof contract.acknowledgement> => { throw error; },
        isDefinitiveWriteFailure: (failure: unknown): failure is AdminApiError => {
          classified.push(failure);
          return classifyWriteDenial(failure);
        },
      }, probe.transport);
      expect(result.kind).toBe(matches ? "confirmed" : "unknown");
      if (result.kind !== "confirmed" && result.kind !== "unknown") throw new Error("Expected readback");
      expect(result.writeError).toBe(error);
      expect(result.acknowledgement).toBeNull();
      expect(classified).toEqual([]);
      expect(probe.calls).toEqual({ write: 1, read: 1 });
    });
  }

  test.each([
    new AdminApiError("Post-write conflict", 409),
    new AdminApiError("Server error", 500),
    new TypeError("Network failure"),
    "unstructured transport rejection",
  ])("unclassified write failures read once without replay: %s", async (error) => {
    const probe = setup(() => { throw error; });
    const result = await executeAuthoritativeCommand(input, {
      ...contract, isDefinitiveWriteFailure: classifyWriteDenial,
    }, probe.transport);
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") throw new Error("Expected authority to confirm");
    expect(result.writeError).toBe(error);
    expect(result.acknowledgement).toBeNull();
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  for (const writeFailed of [true, false]) {
    test.each([true, false])(`read 403 is cached and never denied; writeFailed=${writeFailed}, sync=%s`, async (synchronous) => {
      const writeError = new Error("Unknown write outcome");
      const readError = new AdminApiError("Read forbidden", 403);
      const classified: unknown[] = [];
      const probe = setup(async () => {
        if (writeFailed) throw writeError;
        return acknowledgement;
      }, () => {
        if (synchronous) throw readError;
        return Promise.reject(readError);
      });
      const result = await executeAuthoritativeCommand(input, {
        ...contract,
        isDefinitiveWriteFailure: (failure: unknown): failure is AdminApiError => {
          classified.push(failure);
          return classifyWriteDenial(failure);
        },
      }, probe.transport);
      expect(result.kind).toBe("unknown");
      if (result.kind !== "unknown") throw new Error("Expected unknown readback");
      expect(result.authority).toBeNull();
      expect(result.acknowledgement).toEqual(writeFailed ? null : acknowledgement);
      expect(result.writeError).toBe(writeFailed ? writeError : null);
      expect(result.readError).toBe(readError);
      expect(classified).toEqual(writeFailed ? [writeError] : []);
      expect(probe.calls).toEqual({ write: 1, read: 1 });
    });
  }

  test("authority decoder authorization errors never reach the write classifier", async () => {
    const error = new AdminApiError("Authority decoder rejected", 403);
    const classified: unknown[] = [];
    let decoded = 0;
    const probe = setup();
    const result = await executeAuthoritativeCommand(input, {
      ...contract,
      authority: (_value: unknown): ReturnType<typeof contract.authority> => {
        decoded++;
        throw error;
      },
      isDefinitiveWriteFailure: (failure: unknown): failure is AdminApiError => {
        classified.push(failure);
        return classifyWriteDenial(failure);
      },
    }, probe.transport);
    expect(result.kind).toBe("unknown");
    if (result.kind !== "unknown") throw new Error("Expected invalid authority to remain unknown");
    expect(result.readError).toBe(error);
    expect(result.writeError).toBeNull();
    expect(result.authority).toBeNull();
    expect(decoded).toBe(1);
    expect(classified).toEqual([]);
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  test.each([null, {}, { id: "", enabled: true }, { id: "target-a", enabled: "true" }])(
    "invalid input has zero transport effects: %j", async (value) => {
      const probe = setup();
      const result = await executeAuthoritativeCommand(value, contract, probe.transport);
      expect(result.kind).toBe("invalid");
      if (result.kind !== "invalid") throw new Error("Expected invalid input");
      expect(result.error).toBeInstanceOf(Error);
      expect(probe.calls).toEqual({ write: 0, read: 0 });
    },
  );

  test.each([null, {}, { id: "target-a", enabled: "true" }])(
    "malformed authority is rejected and its read is not repeated: %j", async (value) => {
      const probe = setup(undefined, async () => value);
      const result = await executeAuthoritativeCommand(input, contract, probe.transport);
      expect(result.kind).toBe("unknown");
      if (result.kind !== "unknown") throw new Error("Expected unknown authority");
      expect(result.authority).toBeNull();
      expect(result.acknowledgement).toEqual(acknowledgement);
      expect(result.readError).toBeInstanceOf(Error);
      expect(result.writeError).toBeNull();
      expect(probe.calls).toEqual({ write: 1, read: 1 });
    },
  );

  test.each([{ ...authority, id: "target-b" }, { ...authority, enabled: false }])(
    "valid but unrelated authority never confirms: %j", async (observed) => {
      const probe = setup(undefined, async () => observed);
      const result = await executeAuthoritativeCommand(input, contract, probe.transport);
      expect(result.kind).toBe("unknown");
      if (result.kind !== "unknown") throw new Error("Expected unmatched authority");
      expect(result.authority).toEqual(observed);
      expect(result.readError).toBeNull();
      expect(probe.calls).toEqual({ write: 1, read: 1 });
    },
  );

  test.each([true, false])("malformed acknowledgement requires authority; matches=%s", async (matches) => {
    const probe = setup(async () => ({ accepted: "yes" }), async () => ({ ...authority, enabled: matches }));
    const result = await executeAuthoritativeCommand(input, contract, probe.transport);
    expect(result.kind).toBe(matches ? "confirmed" : "unknown");
    if (result.kind !== "confirmed" && result.kind !== "unknown") throw new Error("Expected readback");
    expect(result.acknowledgement).toBeNull();
    expect(result.writeError).toBeInstanceOf(Error);
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  test("concurrent calls isolate pending reads and observations, later calls read again", async () => {
    const pending = Promise.withResolvers<unknown>();
    const firstRead = Promise.withResolvers<void>();
    const error = new Error("First write failed");
    const received: string[] = [];
    const probe = setup(async (value) => {
      if (value.id === input.id) throw error;
      return acknowledgement;
    }, (value) => {
      received.push(value.id);
      if (value.id === input.id) {
        firstRead.resolve();
        return pending.promise;
      }
      return Promise.resolve({ ...value });
    });
    const first = executeAuthoritativeCommand(input, contract, probe.transport);
    await firstRead.promise;
    const secondInput = { ...input, id: "target-b" };
    const second = await executeAuthoritativeCommand(secondInput, contract, probe.transport);
    expect(second.kind).toBe("confirmed");
    if (second.kind !== "confirmed") throw new Error("Expected independent second authority");
    expect(second.authority).toEqual(secondInput);
    expect(second.writeError).toBeNull();
    expect(second.acknowledgement).toEqual(acknowledgement);
    pending.resolve(authority);
    const firstResult = await first;
    expect(firstResult.kind).toBe("confirmed");
    if (firstResult.kind !== "confirmed") throw new Error("Expected first authority");
    expect(firstResult.authority).toEqual(authority);
    expect(firstResult.writeError).toBe(error);
    expect(firstResult.acknowledgement).toBeNull();
    await executeAuthoritativeCommand(secondInput, contract, probe.transport);
    expect(received).toEqual(["target-a", "target-b", "target-b"]);
    expect(probe.calls).toEqual({ write: 3, read: 3 });
  });
});

const compilerOptions: ts.CompilerOptions = {
  strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
  noImplicitOverride: true, noPropertyAccessFromIndexSignature: true,
  noFallthroughCasesInSwitch: true, skipLibCheck: false, noEmit: true,
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.esnext.d.ts", "lib.dom.d.ts"], types: [],
};

function diagnoseConsumer(source: string) {
  const fixture = fileURLToPath(new URL("./__authoritative_command_consumer__.ts", import.meta.url));
  const host = ts.createCompilerHost(compilerOptions);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, ...args) => name === fixture
    ? ts.createSourceFile(fixture, source, ts.ScriptTarget.ESNext, true)
    : original(name, ...args);
  return ts.getPreEmitDiagnostics(ts.createProgram([fixture], compilerOptions, host)).map((diagnostic) => ({
    code: diagnostic.code,
    file: diagnostic.file?.fileName,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  }));
}

test("authoritative command consumers preserve inferred payloads, nullability and denial type", () => {
  const consumer = `
import { executeAuthoritativeCommand } from "./authoritative-command.js";
declare class WriteDenied extends Error { readonly denialCode: string }
declare const contract: {
  input(value: unknown): string;
  acknowledgement(value: unknown): boolean;
  authority(value: unknown): number;
  matches(input: string, authority: number): boolean;
  isDefinitiveWriteFailure(error: unknown): error is WriteDenied;
};
declare const transport: {
  write(input: string): Promise<unknown>;
  read(input: string): Promise<unknown>;
};
const result = await executeAuthoritativeCommand("target", contract, transport);
if (result.kind === "confirmed") {
  const authority: number = result.authority;
  const acknowledgement: boolean | null = result.acknowledgement;
  const writeError: unknown = result.writeError;
  const readError: unknown = result.readError;
}
if (result.kind === "unknown") {
  const authority: number | null = result.authority;
}
if (result.kind === "denied") {
  const code: string = result.error.denialCode;
}
if (result.kind === "invalid") {
  const error: unknown = result.error;
}
`;
  expect(diagnoseConsumer(consumer)).toEqual([]);
  const rejected = diagnoseConsumer(`${consumer}
if (result.kind === "confirmed") {
  const wrongAuthority: string = result.authority;
  const missingAckGuard: boolean = result.acknowledgement;
}
if (result.kind === "unknown") {
  const missingAuthorityGuard: number = result.authority;
}
if (result.kind === "denied") {
  const wrongDenialCode: number = result.error.denialCode;
}
`);
  expect(rejected.map((diagnostic) => diagnostic.code)).toEqual([2322, 2322, 2322, 2322]);
  expect(rejected.every((diagnostic) =>
    diagnostic.file?.endsWith("/__authoritative_command_consumer__.ts"))).toBe(true);
});
