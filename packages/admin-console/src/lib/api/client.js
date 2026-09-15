// Management contracts are shared with the SDK; authentication remains in the BFF transport.
import { adminEndpoints } from "@supauth/shared";
import { adminEndpointRequest, adminUploadRequest } from "../admin-api.js";

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getOAuthServerStatus">>}
 */
export function getOAuthServerStatus(options = {}) {
  return adminEndpointRequest(adminEndpoints.getOAuthServerStatus, {  }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getProject">>}
 */
export function getProject(options = {}) {
  return adminEndpointRequest(adminEndpoints.getProject, {  }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getDiscovery">>}
 */
export function getDiscovery(options = {}) {
  return adminEndpointRequest(adminEndpoints.getDiscovery, {  }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getJWKS">>}
 */
export function getJWKS(options = {}) {
  return adminEndpointRequest(adminEndpoints.getJWKS, {  }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getCapabilities">>}
 */
export function getCapabilities(options = {}) {
  return adminEndpointRequest(adminEndpoints.getCapabilities, {  }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listApplications">>}
 */
export function listApplications(options = {}) {
  return adminEndpointRequest(adminEndpoints.listApplications, {  }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createApplication">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createApplication">>}
 */
export function createApplication(data, options = {}) {
  return adminEndpointRequest(adminEndpoints.createApplication, { body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getApplication">["params"]["appId"]} appId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getApplication">>}
 */
export function getApplication(appId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getApplication, { params: { appId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateApplication">["params"]["appId"]} appId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateApplication">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateApplication">>}
 */
export function updateApplication(appId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateApplication, { params: { appId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteApplication">["params"]["appId"]} appId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteApplication">>}
 */
export function deleteApplication(appId, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteApplication, { params: { appId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"rotateApplicationSecret">["params"]["appId"]} appId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"rotateApplicationSecret">>}
 */
export function rotateApplicationSecret(appId, options = {}) {
  return adminEndpointRequest(adminEndpoints.rotateApplicationSecret, { params: { appId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getApplicationConsent">["params"]["appId"]} appId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getApplicationConsent">>}
 */
export function getApplicationConsent(appId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getApplicationConsent, { params: { appId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateApplicationConsent">["params"]["appId"]} appId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateApplicationConsent">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateApplicationConsent">>}
 */
export function updateApplicationConsent(appId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateApplicationConsent, { params: { appId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getApplicationSignInExperience">["params"]["appId"]} appId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getApplicationSignInExperience">>}
 */
export function getApplicationSignInExperience(appId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getApplicationSignInExperience, { params: { appId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateApplicationSignInExperience">["params"]["appId"]} appId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateApplicationSignInExperience">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateApplicationSignInExperience">>}
 */
export function updateApplicationSignInExperience(appId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateApplicationSignInExperience, { params: { appId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteApplicationSignInExperience">["params"]["appId"]} appId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteApplicationSignInExperience">>}
 */
export function deleteApplicationSignInExperience(appId, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteApplicationSignInExperience, { params: { appId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listApplicationBindings">["params"]["appId"]} appId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listApplicationBindings">>}
 */
export function listApplicationBindings(appId, options = {}) {
  return adminEndpointRequest(adminEndpoints.listApplicationBindings, { params: { appId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createApplicationBinding">["params"]["appId"]} appId
 * @param {import("@supauth/shared").AdminEndpointInput<"createApplicationBinding">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createApplicationBinding">>}
 */
export function createApplicationBinding(appId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.createApplicationBinding, { params: { appId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteApplicationBinding">["params"]["appId"]} appId
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteApplicationBinding">["params"]["bindingId"]} bindingId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteApplicationBinding">>}
 */
export function deleteApplicationBinding(appId, bindingId, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteApplicationBinding, { params: { appId, bindingId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listApplicationScopes">["params"]["appId"]} appId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listApplicationScopes">>}
 */
export function listApplicationScopes(appId, options = {}) {
  return adminEndpointRequest(adminEndpoints.listApplicationScopes, { params: { appId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listApplicationRoles">["params"]["appId"]} appId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listApplicationRoles">>}
 */
export function listApplicationRoles(appId, options = {}) {
  return adminEndpointRequest(adminEndpoints.listApplicationRoles, { params: { appId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listApplicationLogs">["params"]["appId"]} appId
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"listApplicationLogs">["query"]>} [params]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listApplicationLogs">>}
 */
export function listApplicationLogs(appId, params = {}, options = {}) {
  return adminEndpointRequest(adminEndpoints.listApplicationLogs, { params: { appId }, query: params }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listApplicationOrganizations">["params"]["appId"]} appId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listApplicationOrganizations">>}
 */
export function listApplicationOrganizations(appId, options = {}) {
  return adminEndpointRequest(adminEndpoints.listApplicationOrganizations, { params: { appId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getApplicationAccessControl">["params"]["appId"]} appId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getApplicationAccessControl">>}
 */
export function getApplicationAccessControl(appId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getApplicationAccessControl, { params: { appId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateApplicationAccessControl">["params"]["appId"]} appId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateApplicationAccessControl">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateApplicationAccessControl">>}
 */
export function updateApplicationAccessControl(appId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateApplicationAccessControl, { params: { appId }, body: data }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listConnectors">>}
 */
export function listConnectors(options = {}) {
  return adminEndpointRequest(adminEndpoints.listConnectors, {  }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getConnector">["params"]["connectorId"]} connectorId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getConnector">>}
 */
export function getConnector(connectorId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getConnector, { params: { connectorId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateConnector">["params"]["connectorId"]} connectorId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateConnector">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateConnector">>}
 */
export function updateConnector(connectorId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateConnector, { params: { connectorId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"testConnector">["params"]["connectorId"]} connectorId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"testConnector">>}
 */
export function testConnector(connectorId, options = {}) {
  return adminEndpointRequest(adminEndpoints.testConnector, { params: { connectorId } }, options);
}

/**
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"listConnectorFactories">["query"]>["category"]} [category]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listConnectorFactories">>}
 */
export function listConnectorFactories(category, options = {}) {
  return adminEndpointRequest(adminEndpoints.listConnectorFactories, { query: { ...(category === undefined ? {} : { category: category }) } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"upsertConnectorFactory">["params"]["factoryId"]} factoryId
 * @param {import("@supauth/shared").AdminEndpointInput<"upsertConnectorFactory">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"upsertConnectorFactory">>}
 */
export function upsertConnectorFactory(factoryId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.upsertConnectorFactory, { params: { factoryId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createConnectorFromFactory">["params"]["factoryId"]} factoryId
 * @param {import("@supauth/shared").AdminEndpointInput<"createConnectorFromFactory">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createConnectorFromFactory">>}
 */
export function createConnectorFromFactory(factoryId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.createConnectorFromFactory, { params: { factoryId }, body: data }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listResources">>}
 */
export function listResources(options = {}) {
  return adminEndpointRequest(adminEndpoints.listResources, {  }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createResource">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createResource">>}
 */
export function createResource(data, options = {}) {
  return adminEndpointRequest(adminEndpoints.createResource, { body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getResource">["params"]["resourceId"]} resourceId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getResource">>}
 */
export function getResource(resourceId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getResource, { params: { resourceId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateResource">["params"]["resourceId"]} resourceId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateResource">["body"]} [data]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateResource">>}
 */
export function updateResource(resourceId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateResource, {
    params: { resourceId }, ...(data === undefined ? {} : { body: data }),
  }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteResource">["params"]["resourceId"]} resourceId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteResource">>}
 */
export function deleteResource(resourceId, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteResource, { params: { resourceId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createResourceScope">["params"]["resourceId"]} resourceId
 * @param {import("@supauth/shared").AdminEndpointInput<"createResourceScope">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createResourceScope">>}
 */
export function createResourceScope(resourceId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.createResourceScope, { params: { resourceId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateResourceScope">["params"]["resourceId"]} resourceId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateResourceScope">["params"]["scopeId"]} scopeId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateResourceScope">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateResourceScope">>}
 */
export function updateResourceScope(resourceId, scopeId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateResourceScope, { params: { resourceId, scopeId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteResourceScope">["params"]["resourceId"]} resourceId
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteResourceScope">["params"]["scopeId"]} scopeId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteResourceScope">>}
 */
export function deleteResourceScope(resourceId, scopeId, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteResourceScope, { params: { resourceId, scopeId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listResourceApplications">["params"]["resourceId"]} resourceId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listResourceApplications">>}
 */
export function listResourceApplications(resourceId, options = {}) {
  return adminEndpointRequest(adminEndpoints.listResourceApplications, { params: { resourceId } }, options);
}

/**
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"listUsers">["query"]>} [params]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listUsers">>}
 */
export function listUsers(params = {}, options = {}) {
  return adminEndpointRequest(adminEndpoints.listUsers, { query: params }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createUser">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createUser">>}
 */
export function createUser(data, options = {}) {
  return adminEndpointRequest(adminEndpoints.createUser, { body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getUser">["params"]["userId"]} userId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getUser">>}
 */
export function getUser(userId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getUser, { params: { userId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateUser">["params"]["userId"]} userId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateUser">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateUser">>}
 */
export function updateUser(userId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateUser, { params: { userId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"suspendUser">["params"]["userId"]} userId
 * @param {import("@supauth/shared").AdminEndpointInput<"suspendUser">["body"]} [data]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"suspendUser">>}
 */
export function suspendUser(userId, data = {}, options = {}) {
  return adminEndpointRequest(adminEndpoints.suspendUser, { params: { userId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"unsuspendUser">["params"]["userId"]} userId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"unsuspendUser">>}
 */
export function unsuspendUser(userId, options = {}) {
  return adminEndpointRequest(adminEndpoints.unsuspendUser, { params: { userId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteUser">["params"]["userId"]} userId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteUser">>}
 */
export function deleteUser(userId, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteUser, { params: { userId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getUserPermissions">["params"]["userId"]} userId
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"getUserPermissions">["query"]>["org_id"]} [orgId]
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"getUserPermissions">["query"]>["application_id"]} [applicationId]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getUserPermissions">>}
 */
export function getUserPermissions(userId, orgId, applicationId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getUserPermissions, { params: { userId }, query: { ...(orgId === undefined ? {} : { org_id: orgId }), ...(applicationId === undefined ? {} : { application_id: applicationId }) } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getUserRoles">["params"]["userId"]} userId
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"getUserRoles">["query"]>["application_id"]} [applicationId]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getUserRoles">>}
 */
export function getUserRoles(userId, applicationId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getUserRoles, { params: { userId }, query: { ...(applicationId === undefined ? {} : { application_id: applicationId }) } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"resetUserMfa">["params"]["userId"]} userId
 * @param {import("@supauth/shared").AdminEndpointInput<"resetUserMfa">["params"]["factorId"]} factorId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"resetUserMfa">>}
 */
export function resetUserMfa(userId, factorId, options = {}) {
  return adminEndpointRequest(adminEndpoints.resetUserMfa, { params: { userId, factorId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listUserLogs">["params"]["userId"]} userId
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"listUserLogs">["query"]>} [params]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listUserLogs">>}
 */
export function listUserLogs(userId, params = {}, options = {}) {
  return adminEndpointRequest(adminEndpoints.listUserLogs, { params: { userId }, query: params }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listUserOrganizations">["params"]["userId"]} userId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listUserOrganizations">>}
 */
export function listUserOrganizations(userId, options = {}) {
  return adminEndpointRequest(adminEndpoints.listUserOrganizations, { params: { userId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listUserGrants">["params"]["userId"]} userId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listUserGrants">>}
 */
export function listUserGrants(userId, options = {}) {
  return adminEndpointRequest(adminEndpoints.listUserGrants, { params: { userId } }, options);
}

/**
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"listOrganizations">["query"]>} [params]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listOrganizations">>}
 */
export function listOrganizations(params = {}, options = {}) {
  return adminEndpointRequest(adminEndpoints.listOrganizations, { query: params }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createOrganization">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createOrganization">>}
 */
export function createOrganization(data, options = {}) {
  return adminEndpointRequest(adminEndpoints.createOrganization, { body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getOrganization">["params"]["orgId"]} orgId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getOrganization">>}
 */
export function getOrganization(orgId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getOrganization, { params: { orgId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateOrganization">["params"]["orgId"]} orgId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateOrganization">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateOrganization">>}
 */
export function updateOrganization(orgId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateOrganization, { params: { orgId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteOrganization">["params"]["orgId"]} orgId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteOrganization">>}
 */
export function deleteOrganization(orgId, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteOrganization, { params: { orgId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listOrganizationInvitations">["params"]["orgId"]} orgId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listOrganizationInvitations">>}
 */
export function listOrganizationInvitations(orgId, options = {}) {
  return adminEndpointRequest(adminEndpoints.listOrganizationInvitations, { params: { orgId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createOrganizationInvitation">["params"]["orgId"]} orgId
 * @param {import("@supauth/shared").AdminEndpointInput<"createOrganizationInvitation">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createOrganizationInvitation">>}
 */
export function createOrganizationInvitation(orgId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.createOrganizationInvitation, { params: { orgId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateOrganizationInvitationStatus">["params"]["orgId"]} orgId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateOrganizationInvitationStatus">["params"]["invitationId"]} invitationId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateOrganizationInvitationStatus">["params"]["action"]} action
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateOrganizationInvitationStatus">>}
 */
export function updateOrganizationInvitationStatus(orgId, invitationId, action, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateOrganizationInvitationStatus, { params: { orgId, invitationId, action } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getOrganizationJit">["params"]["orgId"]} orgId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getOrganizationJit">>}
 */
export function getOrganizationJit(orgId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getOrganizationJit, { params: { orgId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateOrganizationJit">["params"]["orgId"]} orgId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateOrganizationJit">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateOrganizationJit">>}
 */
export function updateOrganizationJit(orgId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateOrganizationJit, { params: { orgId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listOrganizationApplications">["params"]["orgId"]} orgId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listOrganizationApplications">>}
 */
export function listOrganizationApplications(orgId, options = {}) {
  return adminEndpointRequest(adminEndpoints.listOrganizationApplications, { params: { orgId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"upsertOrganizationApplication">["params"]["orgId"]} orgId
 * @param {import("@supauth/shared").AdminEndpointInput<"upsertOrganizationApplication">["params"]["appId"]} appId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"upsertOrganizationApplication">>}
 */
export function upsertOrganizationApplication(orgId, appId, options = {}) {
  return adminEndpointRequest(adminEndpoints.upsertOrganizationApplication, { params: { orgId, appId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteOrganizationApplication">["params"]["orgId"]} orgId
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteOrganizationApplication">["params"]["appId"]} appId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteOrganizationApplication">>}
 */
export function deleteOrganizationApplication(orgId, appId, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteOrganizationApplication, { params: { orgId, appId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listOrganizationMembers">["params"]["orgId"]} orgId
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"listOrganizationMembers">["query"]>} [params]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listOrganizationMembers">>}
 */
export function listOrganizationMembers(orgId, params = {}, options = {}) {
  return adminEndpointRequest(adminEndpoints.listOrganizationMembers, { params: { orgId }, query: params }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"addOrganizationMember">["params"]["orgId"]} orgId
 * @param {import("@supauth/shared").AdminEndpointInput<"addOrganizationMember">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"addOrganizationMember">>}
 */
export function addOrganizationMember(orgId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.addOrganizationMember, { params: { orgId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateOrganizationMember">["params"]["orgId"]} orgId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateOrganizationMember">["params"]["userId"]} userId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateOrganizationMember">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateOrganizationMember">>}
 */
export function updateOrganizationMember(orgId, userId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateOrganizationMember, { params: { orgId, userId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"removeOrganizationMember">["params"]["orgId"]} orgId
 * @param {import("@supauth/shared").AdminEndpointInput<"removeOrganizationMember">["params"]["userId"]} userId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"removeOrganizationMember">>}
 */
export function removeOrganizationMember(orgId, userId, options = {}) {
  return adminEndpointRequest(adminEndpoints.removeOrganizationMember, { params: { orgId, userId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getOrganizationBranding">["params"]["orgId"]} orgId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getOrganizationBranding">>}
 */
export function getOrganizationBranding(orgId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getOrganizationBranding, { params: { orgId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateOrganizationBranding">["params"]["orgId"]} orgId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateOrganizationBranding">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateOrganizationBranding">>}
 */
export function updateOrganizationBranding(orgId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateOrganizationBranding, { params: { orgId }, body: data }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listRoles">>}
 */
export function listRoles(options = {}) {
  return adminEndpointRequest(adminEndpoints.listRoles, {  }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createRole">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createRole">>}
 */
export function createRole(data, options = {}) {
  return adminEndpointRequest(adminEndpoints.createRole, { body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getRole">["params"]["roleId"]} roleId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getRole">>}
 */
export function getRole(roleId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getRole, { params: { roleId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateRole">["params"]["roleId"]} roleId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateRole">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateRole">>}
 */
export function updateRole(roleId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateRole, { params: { roleId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteRole">["params"]["roleId"]} roleId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteRole">>}
 */
export function deleteRole(roleId, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteRole, { params: { roleId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listRolePermissions">["params"]["roleId"]} roleId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listRolePermissions">>}
 */
export function listRolePermissions(roleId, options = {}) {
  return adminEndpointRequest(adminEndpoints.listRolePermissions, { params: { roleId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createRolePermission">["params"]["roleId"]} roleId
 * @param {import("@supauth/shared").AdminEndpointInput<"createRolePermission">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createRolePermission">>}
 */
export function createRolePermission(roleId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.createRolePermission, { params: { roleId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteRolePermission">["params"]["roleId"]} roleId
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteRolePermission">["params"]["permissionId"]} permissionId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteRolePermission">>}
 */
export function deleteRolePermission(roleId, permissionId, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteRolePermission, { params: { roleId, permissionId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"assignRole">["params"]["roleId"]} roleId
 * @param {import("@supauth/shared").AdminEndpointInput<"assignRole">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"assignRole">>}
 */
export function assignRole(roleId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.assignRole, { params: { roleId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listRoleAssignments">["params"]["roleId"]} roleId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listRoleAssignments">>}
 */
export function listRoleAssignments(roleId, options = {}) {
  return adminEndpointRequest(adminEndpoints.listRoleAssignments, { params: { roleId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"revokeRole">["params"]["roleId"]} roleId
 * @param {import("@supauth/shared").AdminEndpointInput<"revokeRole">["params"]["assignmentId"]} assignmentId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"revokeRole">>}
 */
export function revokeRole(roleId, assignmentId, options = {}) {
  return adminEndpointRequest(adminEndpoints.revokeRole, { params: { roleId, assignmentId } }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getSignInExperience">>}
 */
export function getSignInExperience(options = {}) {
  return adminEndpointRequest(adminEndpoints.getSignInExperience, {  }, options);
}

/**
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"resolveSignInExperience">["query"]>["application_id"]} [applicationId]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"resolveSignInExperience">>}
 */
export function resolveSignInExperience(applicationId, options = {}) {
  return adminEndpointRequest(adminEndpoints.resolveSignInExperience, { query: { ...(applicationId === undefined ? {} : { application_id: applicationId }) } }, options);
}

/**
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"resolvePublicSignInExperience">["query"]>} [params]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"resolvePublicSignInExperience">>}
 */
export function resolvePublicSignInExperience(params = {}, options = {}) {
  return adminEndpointRequest(adminEndpoints.resolvePublicSignInExperience, { query: params }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateSignInExperience">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateSignInExperience">>}
 */
export function updateSignInExperience(data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateSignInExperience, { body: data }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getCustomUiStatus">>}
 */
export function getCustomUiStatus(options = {}) {
  return adminEndpointRequest(adminEndpoints.getCustomUiStatus, {  }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteCustomUiAssets">>}
 */
export function deleteCustomUiAssets(options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteCustomUiAssets, {  }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getAuthConfig">>}
 */
export function getAuthConfig(options = {}) {
  return adminEndpointRequest(adminEndpoints.getAuthConfig, {  }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getAuthConfigRuntimeConsistency">>}
 */
export function getAuthConfigRuntimeConsistency(options = {}) {
  return adminEndpointRequest(adminEndpoints.getAuthConfigRuntimeConsistency, {  }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateAuthConfig">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateAuthConfig">>}
 */
export function updateAuthConfig(data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateAuthConfig, { body: data }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getCompatibilityReport">>}
 */
export function getCompatibilityReport(options = {}) {
  return adminEndpointRequest(adminEndpoints.getCompatibilityReport, {  }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getCustomAccessTokenHookStatus">>}
 */
export function getCustomAccessTokenHookStatus(options = {}) {
  return adminEndpointRequest(adminEndpoints.getCustomAccessTokenHookStatus, {  }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getCustomAccessTokenHookConfig">>}
 */
export function getCustomAccessTokenHookConfig(options = {}) {
  return adminEndpointRequest(adminEndpoints.getCustomAccessTokenHookConfig, {  }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateCustomAccessTokenHookConfig">["body"]} hookConfig
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateCustomAccessTokenHookConfig">>}
 */
export function updateCustomAccessTokenHookConfig(hookConfig, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateCustomAccessTokenHookConfig, { body: hookConfig }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"verifyCustomAccessTokenHook">>}
 */
export function verifyCustomAccessTokenHook(options = {}) {
  return adminEndpointRequest(adminEndpoints.verifyCustomAccessTokenHook, {  }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getBeforeUserCreatedHookStatus">>}
 */
export function getBeforeUserCreatedHookStatus(options = {}) {
  return adminEndpointRequest(adminEndpoints.getBeforeUserCreatedHookStatus, {  }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"verifyBeforeUserCreatedHook">>}
 */
export function verifyBeforeUserCreatedHook(options = {}) {
  return adminEndpointRequest(adminEndpoints.verifyBeforeUserCreatedHook, {  }, options);
}

/**
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"listTenantConfigs">["query"]>["type"]} [type]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listTenantConfigs">>}
 */
export function listTenantConfigs(type, options = {}) {
  return adminEndpointRequest(adminEndpoints.listTenantConfigs, { query: { ...(type === undefined ? {} : { type: type }) } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"upsertTenantConfig">["params"]["type"]} type
 * @param {import("@supauth/shared").AdminEndpointInput<"upsertTenantConfig">["params"]["key"]} key
 * @param {import("@supauth/shared").AdminEndpointInput<"upsertTenantConfig">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"upsertTenantConfig">>}
 */
export function upsertTenantConfig(type, key, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.upsertTenantConfig, { params: { type, key }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteTenantConfig">["params"]["type"]} type
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteTenantConfig">["params"]["key"]} key
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteTenantConfig">>}
 */
export function deleteTenantConfig(type, key, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteTenantConfig, { params: { type, key } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"checkTenantDomain">["params"]["domain"]} domain
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"checkTenantDomain">>}
 */
export function checkTenantDomain(domain, options = {}) {
  return adminEndpointRequest(adminEndpoints.checkTenantDomain, { params: { domain } }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listWebhooks">>}
 */
export function listWebhooks(options = {}) {
  return adminEndpointRequest(adminEndpoints.listWebhooks, {  }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createWebhook">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createWebhook">>}
 */
export function createWebhook(data, options = {}) {
  return adminEndpointRequest(adminEndpoints.createWebhook, { body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getWebhook">["params"]["webhookId"]} webhookId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getWebhook">>}
 */
export function getWebhook(webhookId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getWebhook, { params: { webhookId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateWebhook">["params"]["webhookId"]} webhookId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateWebhook">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateWebhook">>}
 */
export function updateWebhook(webhookId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateWebhook, { params: { webhookId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteWebhook">["params"]["webhookId"]} webhookId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteWebhook">>}
 */
export function deleteWebhook(webhookId, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteWebhook, { params: { webhookId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"rotateWebhookSecret">["params"]["webhookId"]} webhookId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"rotateWebhookSecret">>}
 */
export function rotateWebhookSecret(webhookId, options = {}) {
  return adminEndpointRequest(adminEndpoints.rotateWebhookSecret, { params: { webhookId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listWebhookLogs">["params"]["webhookId"]} webhookId
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"listWebhookLogs">["query"]>["limit"]} [limit]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listWebhookLogs">>}
 */
export function listWebhookLogs(webhookId, limit = 50, options = {}) {
  return adminEndpointRequest(adminEndpoints.listWebhookLogs, { params: { webhookId }, query: { ...(limit ? { limit } : {}) } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"testWebhook">["params"]["webhookId"]} webhookId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"testWebhook">>}
 */
export function testWebhook(webhookId, options = {}) {
  return adminEndpointRequest(adminEndpoints.testWebhook, { params: { webhookId } }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listWebhookEvents">>}
 */
export function listWebhookEvents(options = {}) {
  return adminEndpointRequest(adminEndpoints.listWebhookEvents, {  }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"listWebhookDeliveries">["params"]["webhookId"]} webhookId
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"listWebhookDeliveries">["query"]>} [params]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listWebhookDeliveries">>}
 */
export function listWebhookDeliveries(webhookId, params = {}, options = {}) {
  return adminEndpointRequest(adminEndpoints.listWebhookDeliveries, { params: { webhookId }, query: params }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getWebhookDelivery">["params"]["webhookId"]} webhookId
 * @param {import("@supauth/shared").AdminEndpointInput<"getWebhookDelivery">["params"]["deliveryId"]} deliveryId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getWebhookDelivery">>}
 */
export function getWebhookDelivery(webhookId, deliveryId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getWebhookDelivery, { params: { webhookId, deliveryId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"replayWebhookDelivery">["params"]["webhookId"]} webhookId
 * @param {import("@supauth/shared").AdminEndpointInput<"replayWebhookDelivery">["params"]["deliveryId"]} deliveryId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"replayWebhookDelivery">>}
 */
export function replayWebhookDelivery(webhookId, deliveryId, options = {}) {
  return adminEndpointRequest(adminEndpoints.replayWebhookDelivery, { params: { webhookId, deliveryId } }, options);
}

/**
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"listAuditLogs">["query"]>} [params]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listAuditLogs">>}
 */
export function listAuditLogs(params = {}, options = {}) {
  return adminEndpointRequest(adminEndpoints.listAuditLogs, { query: params }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getAuditLog">["params"]["logId"]} logId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getAuditLog">>}
 */
export function getAuditLog(logId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getAuditLog, { params: { logId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"exportAuditLogs">["body"]} [params]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"exportAuditLogs">>}
 */
export function exportAuditLogs(params = {}, options = {}) {
  return adminEndpointRequest(adminEndpoints.exportAuditLogs, { body: params }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getAuditExport">["params"]["exportId"]} exportId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getAuditExport">>}
 */
export function getAuditExport(exportId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getAuditExport, { params: { exportId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"downloadAuditExport">["params"]["exportId"]} exportId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<Blob>}
 */
export function downloadAuditExport(exportId, options = {}) {
  return adminEndpointRequest(adminEndpoints.downloadAuditExport, { params: { exportId } }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getAuditIntegrity">>}
 */
export function getAuditIntegrity(options = {}) {
  return adminEndpointRequest(adminEndpoints.getAuditIntegrity, {  }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listStorageBuckets">>}
 */
export function listStorageBuckets(options = {}) {
  return adminEndpointRequest(adminEndpoints.listStorageBuckets, {  }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createStorageBucket">["params"]["bucketId"]} bucketId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createStorageBucket">>}
 */
export function createStorageBucket(bucketId, options = {}) {
  return adminEndpointRequest(adminEndpoints.createStorageBucket, { params: { bucketId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"uploadFile">["params"]["bucketId"]} bucketId
 * @param {import("@supauth/shared").AdminEndpointInput<"uploadFile">["params"]["filePath"]} filePath
 * @param {Blob} file
 * @param {import("@supauth/shared").AdminEndpointInput<"uploadFile">["headers"]["Content-Type"]} contentType
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"uploadFile">>}
 */
export function uploadFile(bucketId, filePath, file, contentType, options = {}) {
  return adminUploadRequest(adminEndpoints.uploadFile, { params: { bucketId, filePath }, headers: { "Content-Type": contentType } }, file, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getSignedUrl">["params"]["bucketId"]} bucketId
 * @param {import("@supauth/shared").AdminEndpointInput<"getSignedUrl">["params"]["filePath"]} filePath
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"getSignedUrl">["query"]>["expires"]} [expiresIn]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getSignedUrl">>}
 */
export function getSignedUrl(bucketId, filePath, expiresIn, options = {}) {
  return adminEndpointRequest(adminEndpoints.getSignedUrl, { params: { bucketId, filePath }, query: { expires: expiresIn || 3600 } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteFile">["params"]["bucketId"]} bucketId
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteFile">["params"]["filePath"]} filePath
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteFile">>}
 */
export function deleteFile(bucketId, filePath, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteFile, { params: { bucketId, filePath } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"uploadAvatar">["params"]["userId"]} userId
 * @param {Blob} file
 * @param {import("@supauth/shared").AdminEndpointInput<"uploadAvatar">["headers"]["Content-Type"]} contentType
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"uploadAvatar">>}
 */
export function uploadAvatar(userId, file, contentType, options = {}) {
  return adminUploadRequest(adminEndpoints.uploadAvatar, { params: { userId }, headers: { "Content-Type": contentType } }, file, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"uploadBranding">["params"]["assetType"]} assetType
 * @param {Blob} file
 * @param {import("@supauth/shared").AdminEndpointInput<"uploadBranding">["headers"]["Content-Type"]} contentType
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"uploadBranding">>}
 */
export function uploadBranding(assetType, file, contentType, options = {}) {
  return adminUploadRequest(adminEndpoints.uploadBranding, { params: { assetType }, headers: { "Content-Type": contentType } }, file, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getBrandingAsset">["params"]["assetType"]} assetType
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<Blob>}
 */
export function getBrandingAsset(assetType, options = {}) {
  return adminEndpointRequest(adminEndpoints.getBrandingAsset, { params: { assetType } }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listOrgTemplates">>}
 */
export function listOrgTemplates(options = {}) {
  return adminEndpointRequest(adminEndpoints.listOrgTemplates, {  }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createOrgTemplate">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createOrgTemplate">>}
 */
export function createOrgTemplate(data, options = {}) {
  return adminEndpointRequest(adminEndpoints.createOrgTemplate, { body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteOrgTemplate">["params"]["templateId"]} templateId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteOrgTemplate">>}
 */
export function deleteOrgTemplate(templateId, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteOrgTemplate, { params: { templateId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"instantiateOrgTemplate">["params"]["templateId"]} templateId
 * @param {import("@supauth/shared").AdminEndpointInput<"instantiateOrgTemplate">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"instantiateOrgTemplate">>}
 */
export function instantiateOrgTemplate(templateId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.instantiateOrgTemplate, { params: { templateId }, body: data, headers: { "Idempotency-Key": globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}` } }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getSecurityConfig">>}
 */
export function getSecurityConfig(options = {}) {
  return adminEndpointRequest(adminEndpoints.getSecurityConfig, {  }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateSecurityConfig">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateSecurityConfig">>}
 */
export function updateSecurityConfig(data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateSecurityConfig, { body: data }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getSecurityStatus">>}
 */
export function getSecurityStatus(options = {}) {
  return adminEndpointRequest(adminEndpoints.getSecurityStatus, {  }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getProvisioningStatus">["params"]["projectRef"]} projectRef
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getProvisioningStatus">>}
 */
export function getProvisioningStatus(projectRef, options = {}) {
  return adminEndpointRequest(adminEndpoints.getProvisioningStatus, { params: { projectRef } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"reconcileProject">["params"]["projectRef"]} projectRef
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"reconcileProject">>}
 */
export function reconcileProject(projectRef, options = {}) {
  return adminEndpointRequest(adminEndpoints.reconcileProject, { params: { projectRef } }, options);
}

/**
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"listTenantMembers">["query"]>} [params]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listTenantMembers">>}
 */
export function listTenantMembers(params = {}, options = {}) {
  return adminEndpointRequest(adminEndpoints.listTenantMembers, { query: params }, options);
}

/**
 * @param {NonNullable<import("@supauth/shared").AdminEndpointInput<"listTenantInvitations">["query"]>} [params]
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listTenantInvitations">>}
 */
export function listTenantInvitations(params = {}, options = {}) {
  return adminEndpointRequest(adminEndpoints.listTenantInvitations, { query: params }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createTenantInvitation">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createTenantInvitation">>}
 */
export function createTenantInvitation(data, options = {}) {
  return adminEndpointRequest(adminEndpoints.createTenantInvitation, { body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateTenantMember">["params"]["memberId"]} memberId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateTenantMember">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateTenantMember">>}
 */
export function updateTenantMember(memberId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateTenantMember, { params: { memberId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"removeTenantMember">["params"]["memberId"]} memberId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"removeTenantMember">>}
 */
export function removeTenantMember(memberId, options = {}) {
  return adminEndpointRequest(adminEndpoints.removeTenantMember, { params: { memberId } }, options);
}

/**
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"listEnterpriseSSOConfigs">>}
 */
export function listEnterpriseSSOConfigs(options = {}) {
  return adminEndpointRequest(adminEndpoints.listEnterpriseSSOConfigs, {  }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"getEnterpriseSSOConfig">["params"]["configId"]} configId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"getEnterpriseSSOConfig">>}
 */
export function getEnterpriseSSOConfig(configId, options = {}) {
  return adminEndpointRequest(adminEndpoints.getEnterpriseSSOConfig, { params: { configId } }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"createEnterpriseSSOConfig">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"createEnterpriseSSOConfig">>}
 */
export function createEnterpriseSSOConfig(data, options = {}) {
  return adminEndpointRequest(adminEndpoints.createEnterpriseSSOConfig, { body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"updateEnterpriseSSOConfig">["params"]["configId"]} configId
 * @param {import("@supauth/shared").AdminEndpointInput<"updateEnterpriseSSOConfig">["body"]} data
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"updateEnterpriseSSOConfig">>}
 */
export function updateEnterpriseSSOConfig(configId, data, options = {}) {
  return adminEndpointRequest(adminEndpoints.updateEnterpriseSSOConfig, { params: { configId }, body: data }, options);
}

/**
 * @param {import("@supauth/shared").AdminEndpointInput<"deleteEnterpriseSSOConfig">["params"]["configId"]} configId
 * @param {import("../admin-api.js").AdminRequestOptions} [options]
 * @returns {Promise<import("@supauth/shared").AdminEndpointResult<"deleteEnterpriseSSOConfig">>}
 */
export function deleteEnterpriseSSOConfig(configId, options = {}) {
  return adminEndpointRequest(adminEndpoints.deleteEnterpriseSSOConfig, { params: { configId } }, options);
}
