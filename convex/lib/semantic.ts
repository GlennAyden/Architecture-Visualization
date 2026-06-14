import { v } from 'convex/values';

export const layerPurposeValidator = v.union(
  v.literal('surfaces'),
  v.literal('application'),
  v.literal('backend'),
  v.literal('data'),
  v.literal('agents'),
  v.literal('infra'),
  v.literal('external'),
  v.literal('custom'),
);

export const nodeSemanticKindValidator = v.union(
  v.literal('surface'),
  v.literal('capability'),
  v.literal('api'),
  v.literal('data_logic'),
  v.literal('agent'),
  v.literal('worker'),
  v.literal('storage'),
  v.literal('external_service'),
  v.literal('config'),
  v.literal('test_harness'),
  v.literal('unknown'),
);

export const linkedFileRoleValidator = v.union(
  v.literal('primary'),
  v.literal('ui'),
  v.literal('route'),
  v.literal('api'),
  v.literal('schema'),
  v.literal('query'),
  v.literal('mutation'),
  v.literal('worker'),
  v.literal('config'),
  v.literal('test'),
  v.literal('support'),
);

export const mappingStatusValidator = v.union(
  v.literal('manual'),
  v.literal('suggested'),
  v.literal('auto_mapped'),
  v.literal('verified'),
  v.literal('ignored'),
  v.literal('drifted'),
);

export const relationshipSuggestionStatusValidator = v.union(
  v.literal('pending'),
  v.literal('applied'),
  v.literal('rejected'),
  v.literal('ignored'),
);

export const architectureFlowKindValidator = v.union(
  v.literal('user_journey'),
  v.literal('system_process'),
  v.literal('data_flow'),
  v.literal('agent_workflow'),
  v.literal('build_deploy'),
  v.literal('integration'),
);

export const architectureFlowStatusValidator = v.union(
  v.literal('pending'),
  v.literal('applied'),
  v.literal('rejected'),
  v.literal('ignored'),
);

export const edgeTypeValidator = v.union(
  v.literal('hierarchy'),
  v.literal('dependency'),
  v.literal('navigation'),
  v.literal('data_flow'),
);

export const manualEdgeTypeValidator = v.union(
  v.literal('dependency'),
  v.literal('navigation'),
  v.literal('data_flow'),
);
