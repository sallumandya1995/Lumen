import {integer,primaryKey,sqliteTable,text} from 'drizzle-orm/sqlite-core';
export const governanceWorkspaces=sqliteTable('governance_workspaces',{
 id:text('id').primaryKey(),revision:integer('revision').notNull().default(0),
 head:text('head').notNull().default(''),mutation:text('mutation').notNull().default(''),
 privateKey:text('private_key').notNull(),publicKey:text('public_key').notNull(),createdAt:text('created_at').notNull()
});
export const governanceRecords=sqliteTable('governance_records',{
 workspace:text('workspace').notNull(),kind:text('kind').notNull(),id:text('id').notNull(),data:text('data').notNull()
},t=>[primaryKey({columns:[t.workspace,t.kind,t.id]})]);
export const governanceLedger=sqliteTable('governance_ledger',{
 workspace:text('workspace').notNull(),sequence:integer('sequence').notNull(),entry:text('entry').notNull(),hash:text('hash').notNull()
},t=>[primaryKey({columns:[t.workspace,t.sequence]})]);
export const governanceKeys=sqliteTable('governance_keys',{
 id:text('id').primaryKey(),workspace:text('workspace').notNull(),agentId:text('agent_id').notNull(),
 name:text('name').notNull(),hash:text('hash').notNull(),createdAt:text('created_at').notNull(),
 expiresAt:text('expires_at').notNull(),revokedAt:text('revoked_at'),lastSeen:text('last_seen')
});
