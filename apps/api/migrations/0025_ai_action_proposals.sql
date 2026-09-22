CREATE TABLE ai_action_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores,
  employee_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('supplier','product','purchase')),
  operation text NOT NULL CHECK (operation IN ('create','update')),
  summary text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','applied','rejected')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  decided_at timestamptz,
  FOREIGN KEY (conversation_id,store_id) REFERENCES ai_conversations(id,store_id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id,store_id) REFERENCES employees(id,store_id)
);
CREATE INDEX ai_action_proposals_message ON ai_action_proposals(message_id);
CREATE INDEX ai_action_proposals_owner ON ai_action_proposals(store_id,employee_id,status);
