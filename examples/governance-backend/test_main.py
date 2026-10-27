"""Local endpoint contract tests; no network or real agent calls."""
import os
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
import main

class ContractTests(unittest.TestCase):
    def setUp(self):
        self.original = deepcopy(main.state)
        os.environ['DEMO_USER_ID'] = 'u-owner'
        self.client = TestClient(main.app)

    def tearDown(self):
        main.state = self.original
        os.environ.pop('DEMO_USER_ID', None)

    def test_lists_and_relationships(self):
        for route in main.ENDPOINTS:
            response = self.client.get('/api/' + route)
            self.assertEqual(response.status_code, 200, route)
            self.assertIsInstance(response.json(), list)
        runs = {r['id'] for r in self.client.get('/api/runs').json()}
        for route in ['tool-calls', 'policy-events', 'approvals']:
            self.assertTrue(all(r['runId'] in runs for r in self.client.get('/api/' + route).json()))

    def test_global_policy_defaults_only_fill_missing_bundles(self):
        legacy = {'updatedAt': '2026-10-21T10:00:00Z', 'users': [{'id': 'owner-custom', 'role': 'Owner'}], 'runs': [{'id': 'keep-history'}]}
        upgraded = main.with_global_policy_defaults(legacy)
        self.assertNotIn('globalPolicies', legacy)
        self.assertEqual(upgraded['runs'], legacy['runs'])
        bundle = upgraded['globalPolicies']
        self.assertEqual(bundle['revision'], 1)
        self.assertEqual(bundle['updatedAt'], legacy['updatedAt'])
        self.assertEqual(bundle['updatedBy'], 'owner-custom')
        self.assertEqual([(r['name'], r['stage'], r['action'], r['severity'], r['enabled']) for r in bundle['rules']], [
            ('Protect credentials', 'Input', 'Block', 'High', True),
            ('Tenant isolation', 'Tool', 'Block', 'High', True),
            ('Review external actions', 'Tool', 'Require approval', 'High', True),
        ])
        self.assertIn('general safety guidance', bundle['rules'][0]['description'])
        self.assertIn('assigned tenant', bundle['rules'][1]['description'])
        self.assertIn('Read-only lookups, drafts, and internal summaries do not require approval.', bundle['rules'][2]['description'])
        for rules in [[], [dict(bundle['rules'][0], name='Customized rule')]]:
            explicit = {**legacy, 'globalPolicies': dict(revision=8, updatedAt=legacy['updatedAt'], updatedBy='owner-custom', rules=rules)}
            saved = deepcopy(explicit)
            self.assertIs(main.with_global_policy_defaults(explicit), explicit)
            self.assertEqual(explicit, saved)

    def test_global_policy_read_access_and_owner_only_write(self):
        current = deepcopy(main.state['globalPolicies'])
        for user in main.state['users']:
            with self.subTest(role=user['role']):
                os.environ['DEMO_USER_ID'] = user['id']
                response = self.client.get('/api/global-policies')
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json(), current)
                if user['role'] != 'Owner':
                    before = deepcopy(main.state)
                    response = self.client.post('/api/global-policies', json={'expectedRevision': current['revision'], 'rules': []})
                    self.assertEqual(response.status_code, 403, response.text)
                    self.assertEqual(main.state, before)

    def test_global_policy_save_revision_and_audit_are_atomic(self):
        current = self.client.get('/api/global-policies').json()
        old_definitions = deepcopy(main.state['definitions'])
        old_runs = deepcopy(main.state['runs'])
        rules = deepcopy(main.create_default_global_policies()['rules'])
        rules[0]['id'] = ' protect-credentials '
        rules[0]['name'] = ' Protect credentials '
        response = self.client.post('/api/global-policies', json={'expectedRevision': current['revision'], 'rules': rules})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()['executed'])
        saved = self.client.get('/api/global-policies').json()
        self.assertEqual(saved['revision'], current['revision'] + 1)
        self.assertEqual(saved['updatedBy'], 'u-owner')
        self.assertEqual(saved['rules'][0]['id'], 'protect-credentials')
        self.assertEqual(saved['rules'][0]['name'], 'Protect credentials')
        self.assertEqual(main.state['definitions'], old_definitions)
        self.assertEqual(main.state['runs'], old_runs)
        self.assertTrue(any(a['target'] == 'global-policies' and a['action'] == 'Global policies saved' and a['actorId'] == 'u-owner' for a in main.state['audit']))
        before = deepcopy(main.state)
        stale = self.client.post('/api/global-policies', json={'expectedRevision': current['revision'], 'rules': []})
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(main.state, before)
        cleared = self.client.post('/api/global-policies', json={'expectedRevision': saved['revision'], 'rules': []})
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertEqual(self.client.get('/api/global-policies').json()['rules'], [])

    def test_invalid_global_policy_schema_is_rejected_without_mutation(self):
        current = main.state['globalPolicies']
        rule = main.create_default_global_policies()['rules'][0]
        base = {'expectedRevision': current['revision'], 'rules': [rule]}
        bad = [
            {**base, 'expectedRevision': 0}, {**base, 'expectedRevision': True}, {**base, 'extra': 'not allowed'},
            {**base, 'rules': [rule, {**rule, 'id': ' protect-credentials ', 'name': 'Another name'}]},
            {**base, 'rules': [rule, {**rule, 'id': 'different', 'name': ' PROTECT CREDENTIALS '}]},
            {**base, 'rules': [{**rule, 'id': '   '}]},
            {**base, 'rules': [{**rule, 'stage': 'Internal'}]},
            {**base, 'rules': [{**rule, 'enabled': 'yes'}]},
            {**base, 'rules': [{**rule, 'description': 'x' * 2001}]},
            {**base, 'rules': [{**rule, 'extra': 'not allowed'}]},
            {**base, 'rules': [{**rule, 'id': f'rule-{i}', 'name': f'Rule {i}'} for i in range(31)]},
        ]
        before = deepcopy(main.state)
        for payload in bad:
            with self.subTest(payload=payload):
                response = self.client.post('/api/global-policies', json=payload)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(main.state, before)

    def test_delegate_decide_audit(self):
        sme = next(u for u in main.state['users'] if u['id'] == 'u-sme')
        item = next(a for a in main.state['approvals'] if a['status'] == 'Pending' and a['agentId'] in sme['agentIds'])
        path = '/api/reviews/' + item['id'] + '/assign'
        self.assertEqual(self.client.post(path, json={'assigneeId': sme['id'], 'note': 'Privacy expertise'}).status_code, 200)
        self.assertEqual(self.client.post(path, json={'assigneeId': sme['id']}).status_code, 409)
        os.environ['DEMO_USER_ID'] = sme['id']
        inbox = self.client.get('/api/approvals').json()
        self.assertTrue(all(a['assigneeId'] == sme['id'] for a in inbox))
        self.assertEqual(self.client.get('/api/connectors').json(), [])
        decision = '/api/approvals/' + item['id'] + '/decision'
        self.assertEqual(self.client.post(decision, json={'decision': 'Approved', 'note': 'Recipient scope verified.'}).status_code, 200)
        self.assertEqual(self.client.post(decision, json={'decision': 'Rejected', 'note': 'Duplicate'}).status_code, 409)
        self.assertTrue(any(a['action'] == 'Approval approved' for a in self.client.get('/api/audit-events').json()))

    def test_connector_is_mock_and_permissions_hold(self):
        draft = dict(name='Example node', type='MCP', framework='Custom', endpoint='https://agent.example.invalid/mcp')
        result = self.client.post('/api/connectors/test', json=draft)
        self.assertTrue(result.json()['ok'])
        bad = {**draft, 'endpoint': 'https://user:secret@example.invalid/mcp'}
        self.assertEqual(self.client.post('/api/connectors/test', json=bad).status_code, 422)
        self.assertEqual(self.client.post('/api/connectors', json=draft).json()['status'], 'Not tested')
        os.environ['DEMO_USER_ID'] = 'u-sme'
        self.assertEqual(self.client.post('/api/connectors', json=draft).status_code, 403)
        hidden = next(a for a in main.state['approvals'] if a['assigneeId'] != 'u-sme')
        self.assertEqual(self.client.post('/api/approvals/' + hidden['id'] + '/decision', json={'decision':'Approved','note':'Not mine'}).status_code, 403)

    def test_expiry_audits_and_prevents_reassignment(self):
        item = next(a for a in main.state['approvals'] if a['status'] == 'Pending')
        item['expiresAt'] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        path = '/api/reviews/' + item['id'] + '/assign'
        self.assertEqual(self.client.post(path, json={'assigneeId': 'u-owner'}).status_code, 409)
        self.assertEqual(item['status'], 'Expired')
        self.assertEqual(self.client.post('/api/approvals/' + item['id'] + '/decision', json={'decision':'Approved','note':'Late review'}).status_code, 409)
        self.client.get('/api/approvals')
        records = [a for a in main.state['audit'] if a['target'] == item['id'] and a['action'] == 'Approval expired']
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['actorId'], 'system')

    def test_admin_created_connectors_remain_visible(self):
        os.environ['DEMO_USER_ID'] = 'u-admin'
        draft = dict(name='  Admin node  ', type='MCP', framework='Custom', endpoint='https://agent.example.invalid/mcp')
        response = self.client.post('/api/connectors', json=draft)
        self.assertEqual(response.status_code, 200)
        item = response.json()
        self.assertEqual(item['name'], 'Admin node')
        self.assertEqual(item['createdById'], 'u-admin')
        self.assertIn(item['id'], [c['id'] for c in self.client.get('/api/connectors').json()])
        self.assertTrue(any(a['target'] == item['id'] for a in self.client.get('/api/audit-events').json()))
        self.assertEqual(self.client.post('/api/connectors', json={**draft, 'name':'   '}).status_code, 422)

    def test_admin_reviewer_scope(self):
        os.environ['DEMO_USER_ID'] = 'u-admin'
        admin = main.actor()
        outside = next(u for u in main.state['users'] if u['role'] == 'SME' and not set(u['agentIds']).intersection(admin['agentIds']))
        self.assertEqual(self.client.post('/api/users/' + outside['id'] + '/availability', json={'available': False}).status_code, 403)
        within = next(u for u in main.state['users'] if u['role'] == 'SME' and set(u['agentIds']).intersection(admin['agentIds']))
        self.assertEqual(self.client.post('/api/users/' + within['id'] + '/availability', json={'available': False}).status_code, 200)

    def configuration(self, agent_id='a-support'):
        agent = next(a for a in main.state['agents'] if a['id'] == agent_id)
        definition = next(d for d in main.state['definitions'] if d['agentId'] == agent_id)
        keys = ['name', 'description', 'framework', 'environment', 'status', 'risk', 'connectorId', 'reviewerIds', 'tools']
        return {'agent': {key: deepcopy(agent[key]) for key in keys}, 'definition': {key: deepcopy(value) for key, value in definition.items() if key not in ['agentId', 'revision', 'updatedAt', 'updatedBy']}, 'expectedRevision': definition['revision']}

    def test_configuration_updates_shared_records_and_audit(self):
        draft = self.configuration()
        original_agent = deepcopy(next(a for a in main.state['agents'] if a['id'] == 'a-support'))
        original_runs = deepcopy(main.state['runs'])
        draft['agent']['name'] = 'Support Concierge · Revised'
        draft['definition']['prompt']['goal'] = 'Handle support requests with a verified source.'
        draft['definition']['guardrails'][0]['name'] = 'Verified support scope'
        response = self.client.post('/api/agents/a-support/configuration', json=draft)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()['executed'])
        agent = next(a for a in self.client.get('/api/agents').json() if a['id'] == 'a-support')
        definition = next(d for d in self.client.get('/api/agent-definitions').json() if d['agentId'] == 'a-support')
        self.assertEqual(agent['name'], draft['agent']['name'])
        self.assertEqual(agent['ownerId'], original_agent['ownerId'])
        self.assertEqual(agent['policies'], [g['name'] for g in draft['definition']['guardrails'] if g['enabled']])
        self.assertEqual(definition['revision'], draft['expectedRevision'] + 1)
        self.assertEqual(definition['prompt']['goal'], draft['definition']['prompt']['goal'])
        self.assertEqual(main.state['runs'], original_runs)
        self.assertTrue(any(a['target'] == 'a-support' and a['action'] == 'Agent configuration saved' for a in self.client.get('/api/audit-events').json()))
        snapshot = deepcopy(main.state)
        self.assertEqual(self.client.post('/api/agents/a-support/configuration', json=draft).status_code, 409)
        self.assertEqual(main.state, snapshot)

    def test_configuration_authorization_and_scoped_definition_reads(self):
        draft = self.configuration()
        os.environ['DEMO_USER_ID'] = 'u-sme'
        self.assertEqual(self.client.post('/api/agents/a-support/configuration', json=draft).status_code, 403)
        visible_agents = {a['id'] for a in self.client.get('/api/agents').json()}
        self.assertEqual({d['agentId'] for d in self.client.get('/api/agent-definitions').json()}, visible_agents)
        os.environ['DEMO_USER_ID'] = 'u-admin'
        admin = main.actor()
        outside = next(a for a in main.state['agents'] if not main.can_access(admin, a['id']))
        self.assertEqual(self.client.post('/api/agents/' + outside['id'] + '/configuration', json=self.configuration(outside['id'])).status_code, 403)

    def test_model_endpoint_config_accepts_custom_ids_and_preserves_other_settings(self):
        draft = self.configuration()
        draft['definition']['model'].update(name='example/tenant-model:adapter-v2', baseUrl='  https://api.tokenfactory.nebius.com/v1  ')
        draft['definition']['prompt']['goal'] = 'Preserve my custom task.'
        before_runs = deepcopy(main.state['runs'])
        response = self.client.post('/api/agents/a-support/configuration', json=draft)
        self.assertEqual(response.status_code, 200, response.text)
        definition = next(d for d in self.client.get('/api/agent-definitions').json() if d['agentId'] == 'a-support')
        self.assertEqual(definition['model']['name'], 'example/tenant-model:adapter-v2')
        self.assertEqual(definition['model']['baseUrl'], 'https://api.tokenfactory.nebius.com/v1/')
        self.assertEqual(definition['model']['provider'], 'Nebius')
        for field in ['prompt', 'memory', 'limits', 'nodes', 'edges', 'guardrails']:
            self.assertEqual(definition[field], draft['definition'][field])
        self.assertEqual(main.state['runs'], before_runs)

    def test_legacy_model_endpoint_defaults_do_not_rewrite_saved_data(self):
        definition = next(d for d in main.state['definitions'] if d['agentId'] == 'a-support')
        defaults = {**main.LEGACY_MODEL_BASE_URLS, 'example/custom:adapter': main.DEFAULT_AGENT_BASE_URL}
        for model_id, expected in defaults.items():
            with self.subTest(model_id=model_id):
                definition['model']['name'] = model_id
                definition['model'].pop('baseUrl', None)
                saved = deepcopy(definition)
                visible = next(d for d in self.client.get('/api/agent-definitions').json() if d['agentId'] == 'a-support')
                self.assertEqual(visible['model']['baseUrl'], expected)
                self.assertEqual(definition, saved)
                draft = self.configuration()
                parsed = main.AgentConfiguration.model_validate(draft)
                self.assertEqual(parsed.definition.model.baseUrl, expected)
                self.assertNotIn('baseUrl', draft['definition']['model'])

    def test_model_endpoint_validation_rejects_unapproved_urls_atomically(self):
        invalid_urls = [
            'https://example.invalid/v1/', 'http://api.tokenfactory.nebius.com/v1/',
            'https://api.tokenfactory.nebius.com.evil.invalid/v1/',
            'https://user:password@api.tokenfactory.nebius.com/v1/',
            'https://api.tokenfactory.nebius.com:443/v1/',
            'https://api.tokenfactory.nebius.com/v1/?api_key=secret',
            'https://api.tokenfactory.nebius.com/v1/#fragment',
            'https://api.tokenfactory.nebius.com/anything/../v1/',
            'https://api.tokenfactory.nebius.com/%76%31/',
            'https://api.tokenfactory.nebius.com/v1/chat/completions', None, '',
        ]
        original = deepcopy(main.state)
        for endpoint in invalid_urls:
            with self.subTest(endpoint=endpoint):
                draft = self.configuration()
                draft['definition']['model']['baseUrl'] = endpoint
                self.assertEqual(self.client.post('/api/agents/a-support/configuration', json=draft).status_code, 422)
                self.assertEqual(main.state, original)
        for model_id in ['https://example.invalid/model', 'vendor/model?key=secret', 'vendor/model name', 'a' * 201, '']:
            draft = self.configuration()
            draft['definition']['model']['name'] = model_id
            self.assertEqual(self.client.post('/api/agents/a-support/configuration', json=draft).status_code, 422)
            self.assertEqual(main.state, original)

    def test_invalid_graph_is_atomic(self):
        draft = self.configuration()
        edge = draft['definition']['edges'][0]
        draft['definition']['edges'].append({'id': 'cycle-test', 'source': edge['target'], 'target': edge['source'], 'label': 'invalid cycle'})
        snapshot = deepcopy(main.state)
        response = self.client.post('/api/agents/a-support/configuration', json=draft)
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn('acyclic', response.json()['detail'])
        self.assertEqual(main.state, snapshot)

    def test_invalid_tool_and_owner_mutation_are_rejected(self):
        draft = self.configuration()
        draft['agent']['tools'] = ['credential_dump']
        snapshot = deepcopy(main.state)
        self.assertEqual(self.client.post('/api/agents/a-support/configuration', json=draft).status_code, 422)
        self.assertEqual(main.state, snapshot)
        draft = self.configuration()
        draft['agent']['ownerId'] = 'u-admin'
        self.assertEqual(self.client.post('/api/agents/a-support/configuration', json=draft).status_code, 422)
        self.assertEqual(main.state, snapshot)

    def test_governance_status_change_invalidates_open_draft(self):
        os.environ['DEMO_USER_ID'] = 'u-admin'
        draft = self.configuration()
        self.assertEqual(self.client.post('/api/agents/a-support/status', json={'status':'Paused'}).status_code, 200)
        self.assertEqual(self.client.post('/api/agents/a-support/configuration', json=draft).status_code, 409)
        refreshed = self.configuration()
        self.assertEqual(refreshed['agent']['status'], 'Paused')
        self.assertEqual(refreshed['expectedRevision'], draft['expectedRevision'] + 1)
        refreshed['agent']['description'] = 'Updated by the assigned admin.'
        self.assertEqual(self.client.post('/api/agents/a-support/configuration', json=refreshed).status_code, 200)

    def execution(self, status='Success', agent_id='a-support'):
        definition = next(d for d in main.state['definitions'] if d['agentId'] == agent_id)
        return dict(id='RUN-contract-receipt', agentId=agent_id, configurationRevision=definition['revision'], mode='agent', input='Prepare a support response.', output='<think>private scratchpad</think>Ready for review.', status=status, at=main.now(), duration=2300, tokens=45, cost=0, costKnown=False, model='nvidia/Nemotron-3-Ultra-550b-a55b', nodes=[dict(nodeId='coordinator', label='Coordinator', kind='Agent', status='Success', input='Support request', output='Proposed answer', summary='Prepared a concise answer from provided context.', at=main.now(), duration=2000, tokens=45, cost=0), dict(nodeId='tool-0', label='CRM lookup', kind='Tool', status='Success', input='Masked customer ID', output='Demo account context', summary='Used a demo tool result.', at=main.now(), duration=300, tokens=0, cost=0, toolName='crm_lookup', toolMode='demo')], policies=[], warnings=['Cost unavailable; model pricing not configured.'])

    def test_execution_receipt_records_linked_governance_data_and_deduplicates(self):
        body = self.execution('Awaiting approval')
        body['policies'] = [dict(rule='Human review', severity='High', action='Require approval', context='Review the proposed reply.', nodeId='coordinator')]
        response = self.client.post('/api/agent-executions', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()['executed'])
        run = next(r for r in self.client.get('/api/runs').json() if r['id'] == body['id'])
        self.assertEqual(run['source'], 'live')
        self.assertEqual(run['executionMode'], 'agent')
        self.assertEqual(run['executionStatus'], 'Awaiting approval')
        self.assertEqual(run['output'], 'Ready for review.')
        self.assertEqual(run['duration'], 2300)
        self.assertEqual(run['steps'][0]['nodeId'], 'coordinator')
        self.assertEqual(run['steps'][0]['input'], 'Support request')
        self.assertEqual(run['steps'][0]['output'], 'Proposed answer')
        self.assertEqual(run['steps'][0]['tokens'], 45)
        self.assertEqual(run['steps'][0]['nodeKind'], 'Agent')
        self.assertNotIn('tokenUsage', run)
        self.assertNotIn('tokenUsage', run['steps'][0])
        self.assertNotIn('policyChecks', run['steps'][0])
        self.assertNotIn('baseUrl', run)
        self.assertNotIn('baseUrl', run['steps'][0])
        self.assertNotIn('globalPolicyRevision', run)
        self.assertFalse(run['costKnown'])
        self.assertEqual(run['cost'], 0)
        call = next(c for c in main.state['toolCalls'] if c['runId'] == body['id'])
        self.assertIn('Demo tool', call['output'])
        self.assertEqual(call['latency'], 300)
        self.assertEqual(call['nodeId'], 'tool-0')
        policy = next(p for p in main.state['policies'] if p['runId'] == body['id'])
        self.assertEqual(policy['disposition'], 'Flagged')
        approval = next(a for a in main.state['approvals'] if a['runId'] == body['id'])
        self.assertEqual(approval['status'], 'Pending')
        self.assertIsNone(approval['assigneeId'])
        snapshot = deepcopy(main.state)
        repeat = self.client.post('/api/agent-executions', json=body)
        self.assertTrue(repeat.json()['duplicate'])
        self.assertEqual(main.state, snapshot)
        body['output'] = 'Changed body with the same ID'
        self.assertEqual(self.client.post('/api/agent-executions', json=body).status_code, 409)
        self.assertEqual(main.state, snapshot)

    def test_execution_receipt_role_scope_and_revision_validation_are_atomic(self):
        body = self.execution()
        snapshot = deepcopy(main.state)
        os.environ['DEMO_USER_ID'] = 'u-sme'
        self.assertEqual(self.client.post('/api/agent-executions', json=body).status_code, 403)
        self.assertEqual(main.state, snapshot)
        os.environ['DEMO_USER_ID'] = 'u-admin'
        outside = next(a for a in main.state['agents'] if not main.can_access(main.actor(), a['id']))
        self.assertEqual(self.client.post('/api/agent-executions', json=self.execution(agent_id=outside['id'])).status_code, 403)
        self.assertEqual(main.state, snapshot)
        os.environ['DEMO_USER_ID'] = 'u-owner'
        body['configurationRevision'] += 10
        self.assertEqual(self.client.post('/api/agent-executions', json=body).status_code, 409)
        self.assertEqual(main.state, snapshot)
        body = self.execution()
        body['nodes'][0]['duration'] = -1
        self.assertEqual(self.client.post('/api/agent-executions', json=body).status_code, 422)
        self.assertEqual(main.state, snapshot)
        body = self.execution()
        body['nodes'][1]['toolMode'] = 'live'
        self.assertEqual(self.client.post('/api/agent-executions', json=body).status_code, 422)
        self.assertEqual(main.state, snapshot)
        body = self.execution()
        body['nodes'].append(deepcopy(body['nodes'][0]))
        self.assertEqual(self.client.post('/api/agent-executions', json=body).status_code, 422)
        self.assertEqual(main.state, snapshot)

    def test_execution_policy_evidence_and_token_usage_are_preserved(self):
        body = self.execution('Awaiting approval')
        body['tokenUsage'] = {'generation': 30, 'policy': 15}
        body['nodes'][0]['tokenUsage'] = {'generation': 30, 'policy': 15}
        body['nodes'][1]['tokenUsage'] = {'generation': 0, 'policy': 0}
        body['nodes'][1]['policyChecks'] = []
        body['nodes'][0]['status'] = 'Awaiting approval'
        body['nodes'][0]['policyChecks'] = [
            dict(id='input-check', rule='Input scope', stage='Input', action='Block', violated=False, summary='<analysis>private reasoning</analysis>Input scope passed.'),
            dict(id='review-check', rule='Human review', stage='Output', action='Require approval', violated=True, summary='<think>private scratchpad</think>Review is required before release.'),
        ]
        body['policies'] = [dict(rule='Human review', severity='High', action='Require approval', context='Review the proposed reply.', nodeId='coordinator')]
        response = self.client.post('/api/agent-executions', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        run = next(r for r in self.client.get('/api/runs').json() if r['id'] == body['id'])
        self.assertEqual(run['tokens'], 45)
        self.assertEqual(run['tokenUsage'], {'generation': 30, 'policy': 15})
        step = run['steps'][0]
        self.assertEqual(step['tokens'], 45)
        self.assertEqual(step['tokenUsage'], run['tokenUsage'])
        self.assertEqual(step['nodeKind'], 'Agent')
        self.assertEqual(step['outcome'], 'Awaiting approval')
        self.assertEqual(step['policyChecks'][0], dict(id='input-check', rule='Input scope', stage='Input', action='Block', violated=False, summary='Input scope passed.'))
        self.assertEqual(step['policyChecks'][1], dict(id='review-check', rule='Human review', stage='Output', action='Require approval', violated=True, summary='Review is required before release.'))
        self.assertEqual(run['steps'][1]['nodeKind'], 'Tool')
        self.assertEqual(run['steps'][1]['tokenUsage'], {'generation': 0, 'policy': 0})
        self.assertEqual(run['steps'][1]['policyChecks'], [])
        self.assertEqual(next(a for a in main.state['approvals'] if a['runId'] == body['id'])['status'], 'Pending')
        original = deepcopy(main.state)
        self.assertTrue(self.client.post('/api/agent-executions', json=body).json()['duplicate'])
        self.assertEqual(main.state, original)

    def test_execution_receipt_keeps_parent_and_node_model_endpoints(self):
        body = self.execution()
        body.update(model='example/tenant-model:adapter', baseUrl='https://api.tokenfactory.us-central1.nebius.com/v1/')
        body['nodes'][0].update(model='deepseek-ai/DeepSeek-V4.1-Flash', baseUrl='https://api.tokenfactory.us-north1.nebius.com/v1/')
        response = self.client.post('/api/agent-executions', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        run = next(r for r in self.client.get('/api/runs').json() if r['id'] == body['id'])
        self.assertEqual(run['model'], body['model'])
        self.assertEqual(run['baseUrl'], body['baseUrl'])
        self.assertEqual(run['steps'][0]['model'], body['nodes'][0]['model'])
        self.assertEqual(run['steps'][0]['baseUrl'], body['nodes'][0]['baseUrl'])
        self.assertNotIn('baseUrl', run['steps'][1])
        self.assertTrue(self.client.post('/api/agent-executions', json=body).json()['duplicate'])
        saved = deepcopy(main.state)
        changed = deepcopy(body)
        changed['nodes'][0]['baseUrl'] = 'https://api.tokenfactory.nebius.com/v1/'
        self.assertEqual(self.client.post('/api/agent-executions', json=changed).status_code, 409)
        self.assertEqual(main.state, saved)

    def test_execution_receipt_keeps_global_policy_revision_and_namespaced_check_ids(self):
        body = self.execution()
        body['globalPolicyRevision'] = 3
        body['nodes'][0]['policyChecks'] = [dict(id='global:' + 'r' * 100, rule='Global · Scope check', stage='Input', action='Block', violated=False, summary='The request remains in scope.')]
        response = self.client.post('/api/agent-executions', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        run = next(r for r in self.client.get('/api/runs').json() if r['id'] == body['id'])
        self.assertEqual(run['globalPolicyRevision'], 3)
        self.assertEqual(run['steps'][0]['policyChecks'][0]['id'], body['nodes'][0]['policyChecks'][0]['id'])
        self.assertNotIn('globalPolicyRevision', run['steps'][0])
        self.assertTrue(self.client.post('/api/agent-executions', json=body).json()['duplicate'])
        before = deepcopy(main.state)
        for revision in [0, -1, 1.5, True, None]:
            changed = deepcopy(body)
            changed['globalPolicyRevision'] = revision
            self.assertEqual(self.client.post('/api/agent-executions', json=changed).status_code, 422)
            self.assertEqual(main.state, before)
        changed = deepcopy(body)
        changed['globalPolicyRevision'] = 4
        self.assertEqual(self.client.post('/api/agent-executions', json=changed).status_code, 409)
        self.assertEqual(main.state, before)

    def test_execution_receipt_rejects_invalid_model_routes(self):
        original = deepcopy(main.state)
        for target in ['run', 'node']:
            for field, value in [('baseUrl', 'https://example.invalid/v1/'), ('baseUrl', 'https://key@api.tokenfactory.nebius.com/v1/'), ('baseUrl', None), ('model', 'https://example.invalid/model')]:
                with self.subTest(target=target, field=field, value=value):
                    body = self.execution()
                    (body if target == 'run' else body['nodes'][0])[field] = value
                    self.assertEqual(self.client.post('/api/agent-executions', json=body).status_code, 422)
                    self.assertEqual(main.state, original)

    def test_invalid_token_breakdowns_and_policy_evidence_are_atomic(self):
        valid_check = dict(id='check-1', rule='Scope check', stage='Input', action='Block', violated=False, summary='The input is in scope.')
        cases = []
        for usage in [{'generation': 44, 'policy': 0}, {'generation': -1, 'policy': 46}, {'generation': 30.5, 'policy': 14.5}, {'generation': True, 'policy': 44}, {'generation': 45, 'policy': 0, 'extra': 1}]:
            for target in ['run', 'node']:
                body = self.execution()
                (body if target == 'run' else body['nodes'][0])['tokenUsage'] = usage
                cases.append((target + ' token usage', body))
        for patch in [{'id': 'x' * 201}, {'summary': 'x' * 1001}, {'stage': 'Internal'}, {'action': 'Execute'}, {'violated': 'false'}, {'extra': 'not allowed'}]:
            body = self.execution()
            body['nodes'][0]['policyChecks'] = [{**valid_check, **patch}]
            cases.append(('policy check schema', body))
        body = self.execution()
        body['nodes'][0]['policyChecks'] = [valid_check] * 101
        cases.append(('policy check count', body))
        original = deepcopy(main.state)
        for label, body in cases:
            with self.subTest(label=label, body=body):
                response = self.client.post('/api/agent-executions', json=body)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(main.state, original)

    def test_cancelled_node_receipt_and_prior_revision_are_recorded(self):
        body = self.execution('Cancelled')
        body.update(mode='node', nodeId='coordinator', nodes=[], output='Stopped by user.')
        self.client.post('/api/agents/a-support/status', json={'status':'Paused'})
        response = self.client.post('/api/agent-executions', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        run = next(r for r in main.state['runs'] if r['id'] == body['id'])
        self.assertEqual(run['status'], 'Failed')
        self.assertEqual(run['executionStatus'], 'Cancelled')
        self.assertEqual(run['nodeId'], 'coordinator')
        self.assertEqual(run['configurationRevision'], body['configurationRevision'])
        self.assertEqual(run['steps'][0]['outcome'], 'Cancelled')
        self.assertTrue(any(a['action'] == 'Node test recorded' and a['target'] == body['id'] for a in main.state['audit']))

if __name__ == '__main__':
    unittest.main()
