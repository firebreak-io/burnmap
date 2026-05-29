import type { ChangeModel } from '@burnmap/parser';

/** A representative model used by the dev server and tests. Mirrors the design mockup. */
export const sampleModel: ChangeModel = {
  meta: {
    repo: 'firebreak-io/infra',
    prNumber: 142,
    commitSha: 'a1b9c2f',
    terraformVersion: '1.12.1',
    generatedAt: '2026-05-29T00:00:00Z',
  },
  summary: { create: 4, update: 2, delete: 1, replace: 1, noop: 0, read: 0 },
  modules: [
    {
      module: 'module.data',
      types: [
        {
          type: 'aws_db_instance',
          resources: [
            {
              address: 'module.data.aws_db_instance.main',
              module: 'module.data',
              type: 'aws_db_instance',
              name: 'main',
              provider: 'registry.terraform.io/hashicorp/aws',
              action: 'replace',
              attrs: [
                { path: 'allocated_storage', before: 100, after: 200, sensitive: false, unknown: false, forcesReplacement: false },
                { path: 'engine_version', before: '14.7', after: '15.4', sensitive: false, unknown: false, forcesReplacement: true },
              ],
              dangerScore: 100,
              dangerReasons: [
                'replacement recreates a stateful resource — possible data loss/downtime',
                'forces replacement: engine_version',
              ],
            },
          ],
        },
      ],
    },
    {
      module: 'module.vpc',
      types: [
        {
          type: 'aws_subnet',
          resources: [
            { address: 'module.vpc.aws_subnet.public[0]', module: 'module.vpc', type: 'aws_subnet', name: 'public', provider: 'aws', action: 'create', attrs: [], dangerScore: 10, dangerReasons: [] },
            { address: 'module.vpc.aws_subnet.public[1]', module: 'module.vpc', type: 'aws_subnet', name: 'public', provider: 'aws', action: 'create', attrs: [], dangerScore: 10, dangerReasons: [] },
          ],
        },
        {
          type: 'aws_route_table',
          resources: [
            {
              address: 'module.vpc.aws_route_table.main', module: 'module.vpc', type: 'aws_route_table', name: 'main', provider: 'aws',
              action: 'update',
              attrs: [{ path: 'route[0].gateway_id', before: null, after: '(known after apply)', sensitive: false, unknown: true, forcesReplacement: false }],
              dangerScore: 20, dangerReasons: [],
            },
          ],
        },
      ],
    },
    {
      module: 'module.app',
      types: [
        {
          type: 'aws_security_group_rule',
          resources: [
            { address: 'module.app.aws_security_group_rule.https', module: 'module.app', type: 'aws_security_group_rule', name: 'https', provider: 'aws', action: 'create', attrs: [], dangerScore: 10, dangerReasons: [] },
          ],
        },
        {
          type: 'aws_ecs_service',
          resources: [
            {
              address: 'module.app.aws_ecs_service.web', module: 'module.app', type: 'aws_ecs_service', name: 'web', provider: 'aws',
              action: 'update',
              attrs: [{ path: 'tags.Version', before: '1.4.0', after: '1.5.0', sensitive: false, unknown: false, forcesReplacement: false }],
              dangerScore: 5, dangerReasons: [],
            },
          ],
        },
      ],
    },
    {
      module: '',
      types: [
        {
          type: 'aws_security_group_rule',
          resources: [
            { address: 'aws_security_group_rule.legacy_ingress', module: '', type: 'aws_security_group_rule', name: 'legacy_ingress', provider: 'aws', action: 'delete', attrs: [], dangerScore: 70, dangerReasons: ['resource will be destroyed'] },
          ],
        },
      ],
    },
  ],
  outputs: [
    { name: 'db_endpoint', action: 'update', sensitive: false },
  ],
};
