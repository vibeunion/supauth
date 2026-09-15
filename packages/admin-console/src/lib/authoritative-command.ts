import { createContractCommandClient } from "@supacloud/contracts/client";

export interface AuthoritativeCommandContract<Input, Acknowledgement, Authority, Denial extends Error = Error> {
  input(value: unknown): Input;
  acknowledgement(value: unknown): Acknowledgement;
  authority(value: unknown): Authority;
  matches(input: Input, authority: Authority): boolean;
  isDefinitiveWriteFailure?: (error: unknown) => error is Denial;
}

type Observations<Authority, Acknowledgement> = {
  authority: Authority | null;
  acknowledgement: Acknowledgement | null;
  writeError: unknown;
  readError: unknown;
};

export type AuthoritativeCommandOutcome<Authority, Acknowledgement, Denial extends Error = Error> =
  | ({ kind: "confirmed"; authority: Authority } & Observations<Authority, Acknowledgement>)
  | ({ kind: "unknown" } & Observations<Authority, Acknowledgement>)
  | { kind: "denied"; error: Denial }
  | { kind: "invalid"; error: unknown };

export async function executeAuthoritativeCommand<Input, Acknowledgement, Authority, Denial extends Error = Error>(
  value: unknown,
  contract: AuthoritativeCommandContract<Input, Acknowledgement, Authority, Denial>,
  transport: {
    write(input: Input): Promise<unknown>;
    read(input: Input): Promise<unknown>;
  },
): Promise<AuthoritativeCommandOutcome<Authority, Acknowledgement, Denial>> {
  let input: Input;
  try {
    input = contract.input(value);
  } catch (error) {
    return { kind: "invalid", error };
  }
  const observed: Observations<Authority, Acknowledgement> = {
    authority: null, acknowledgement: null, writeError: null, readError: null,
  };
  const failure: { denial: Denial | null } = { denial: null };
  let readProof: { authority: Authority } | undefined;
  let readPromise: Promise<{ authority: Authority }> | undefined;
  // 成功与拒绝都缓存；send 后的 lookup 只能复用本次读取，不能再发请求。
  const readOnce = () => readPromise ??= Promise.resolve().then(async () => {
    try {
      const authority = contract.authority(await transport.read(input));
      observed.authority = authority;
      readProof = { authority };
      return readProof;
    } catch (error) {
      observed.readError = error;
      throw error;
    }
  });
  const command = createContractCommandClient({
    // SDK 再次解码时只认可本次已校验值，不能将转换后的业务对象当作外部格式重解码。
    input(value: unknown): Input {
      if (!Object.is(value, input)) throw new Error("Unexpected command input");
      return input;
    },
    result(value: unknown): Authority {
      if (readProof === undefined || value !== readProof) {
        throw new Error("Unvalidated command authority");
      }
      return readProof.authority;
    },
  }, {
    async send(decodedInput) {
      let acknowledgement: unknown;
      try {
        acknowledgement = await transport.write(decodedInput);
      } catch (error) {
        observed.writeError = error;
        if (contract.isDefinitiveWriteFailure?.(error)) failure.denial = error;
        throw error;
      }
      // 回执校验发生在写入之后，即使抛出授权形态的错误也不能按写前拒绝处理。
      try {
        observed.acknowledgement = contract.acknowledgement(acknowledgement);
      } catch (error) {
        observed.writeError = error;
        throw error;
      }
      return readOnce();
    },
    lookup: readOnce,
    matches: contract.matches,
    isDefinitiveFailure: (error) => failure.denial !== null && error === failure.denial,
  });
  try {
    const outcome = await command(input);
    return outcome.status === "confirmed"
      ? { ...observed, kind: "confirmed", authority: outcome.result }
      : { ...observed, kind: "unknown" };
  } catch (error) {
    if (failure.denial !== null && error === failure.denial) {
      return { kind: "denied", error: failure.denial };
    }
    return { ...observed, kind: "unknown", writeError: error };
  }
}
