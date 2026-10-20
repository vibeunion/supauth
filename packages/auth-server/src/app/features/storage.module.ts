import { Controller, defineModule, Injectable, Get, Post, Delete } from '@supacloud/app';
import { storageRoutes } from '../../storage/index.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class StoragePostBucketsByBucketIdAction {
  execute(context: Parameters<typeof storageRoutes.operations.postBucketsByBucketId.execute>[0]) {
    requireAdminAction('operations.manage');
    return storageRoutes.operations.postBucketsByBucketId.execute(context);
  }
}

@Injectable()
export class StoragePostUploadByBucketIdWildcardAction {
  execute(context: Parameters<typeof storageRoutes.operations.postUploadByBucketIdWildcard.execute>[0]) {
    requireAdminAction('operations.manage');
    return storageRoutes.operations.postUploadByBucketIdWildcard.execute(context);
  }
}

@Injectable()
export class StorageDeleteDeleteByBucketIdWildcardAction {
  execute(context: Parameters<typeof storageRoutes.operations.deleteDeleteByBucketIdWildcard.execute>[0]) {
    requireAdminAction('operations.manage');
    return storageRoutes.operations.deleteDeleteByBucketIdWildcard.execute(context);
  }
}

@Injectable()
export class StoragePostAvatarByUserIdAction {
  execute(context: Parameters<typeof storageRoutes.operations.postAvatarByUserId.execute>[0]) {
    requireAdminAction('operations.manage');
    return storageRoutes.operations.postAvatarByUserId.execute(context);
  }
}

@Injectable()
export class StoragePostBrandingByAssetTypeAction {
  execute(context: Parameters<typeof storageRoutes.operations.postBrandingByAssetType.execute>[0]) {
    requireAdminAction('operations.manage');
    return storageRoutes.operations.postBrandingByAssetType.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/storage")
export class StorageController {
  constructor(
    private readonly postBucketsByBucketIdAction: StoragePostBucketsByBucketIdAction,
    private readonly postUploadByBucketIdWildcardAction: StoragePostUploadByBucketIdWildcardAction,
    private readonly deleteDeleteByBucketIdWildcardAction: StorageDeleteDeleteByBucketIdWildcardAction,
    private readonly postAvatarByUserIdAction: StoragePostAvatarByUserIdAction,
    private readonly postBrandingByAssetTypeAction: StoragePostBrandingByAssetTypeAction,
  ) {}

  @Get("/buckets", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/storage/index.ts#getBuckets" },
    aspects: [adminHttpAspect],
  })
  getBuckets(ctx: HttpInvocation): Promise<Response> {
    return storageRoutes.operations.getBuckets.invoke(ctx);
  }

  @Post("/buckets/:bucketId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/storage/index.ts#postBucketsByBucketId" },
    aspects: [adminHttpAspect],
  })
  postBucketsByBucketId(ctx: HttpInvocation): Promise<Response> {
    return storageRoutes.operations.postBucketsByBucketId.invoke(ctx, context => this.postBucketsByBucketIdAction.execute(context));
  }

  @Post("/upload/:bucketId/*", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/storage/index.ts#postUploadByBucketIdWildcard" },
    aspects: [adminHttpAspect],
  })
  postUploadByBucketIdWildcard(ctx: HttpInvocation): Promise<Response> {
    return storageRoutes.operations.postUploadByBucketIdWildcard.invoke(ctx, context => this.postUploadByBucketIdWildcardAction.execute(context));
  }

  @Get("/sign-url/:bucketId/*", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/storage/index.ts#getSignUrlByBucketIdWildcard" },
    aspects: [adminHttpAspect],
  })
  getSignUrlByBucketIdWildcard(ctx: HttpInvocation): Promise<Response> {
    return storageRoutes.operations.getSignUrlByBucketIdWildcard.invoke(ctx);
  }

  @Delete("/delete/:bucketId/*", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/storage/index.ts#deleteDeleteByBucketIdWildcard" },
    aspects: [adminHttpAspect],
  })
  deleteDeleteByBucketIdWildcard(ctx: HttpInvocation): Promise<Response> {
    return storageRoutes.operations.deleteDeleteByBucketIdWildcard.invoke(ctx, context => this.deleteDeleteByBucketIdWildcardAction.execute(context));
  }

  @Post("/avatar/:userId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/storage/index.ts#postAvatarByUserId" },
    aspects: [adminHttpAspect],
  })
  postAvatarByUserId(ctx: HttpInvocation): Promise<Response> {
    return storageRoutes.operations.postAvatarByUserId.invoke(ctx, context => this.postAvatarByUserIdAction.execute(context));
  }

  @Get("/branding/:assetType", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/storage/index.ts#getBrandingByAssetType" },
    aspects: [adminHttpAspect],
  })
  getBrandingByAssetType(ctx: HttpInvocation): Promise<Response> {
    return storageRoutes.operations.getBrandingByAssetType.invoke(ctx);
  }

  @Post("/branding/:assetType", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/storage/index.ts#postBrandingByAssetType" },
    aspects: [adminHttpAspect],
  })
  postBrandingByAssetType(ctx: HttpInvocation): Promise<Response> {
    return storageRoutes.operations.postBrandingByAssetType.invoke(ctx, context => this.postBrandingByAssetTypeAction.execute(context));
  }

}

export const StorageModule = defineModule({
  name: 'supauth-storage',
  tags: ['type:feature', 'scope:supauth-storage'],
  providers: [StoragePostBucketsByBucketIdAction, StoragePostUploadByBucketIdWildcardAction, StorageDeleteDeleteByBucketIdWildcardAction, StoragePostAvatarByUserIdAction, StoragePostBrandingByAssetTypeAction],
  controllers: [StorageController],
});
