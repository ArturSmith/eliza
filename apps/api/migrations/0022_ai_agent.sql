CREATE TABLE ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores,
  employee_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'New conversation',
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  summary text NOT NULL DEFAULT '',
  summary_through_seq bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,store_id),
  FOREIGN KEY(employee_id,store_id) REFERENCES employees(id,store_id)
);
CREATE INDEX ai_conversations_owner_date ON ai_conversations(store_id,employee_id,updated_at DESC);
CREATE TABLE ai_messages (
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  role text NOT NULL CHECK(role IN ('user','assistant')),
  content text NOT NULL CHECK(length(content)<=12000),
  document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(conversation_id,store_id) REFERENCES ai_conversations(id,store_id) ON DELETE CASCADE,
  FOREIGN KEY(document_id,store_id) REFERENCES scanned_documents(id,store_id)
);
CREATE INDEX ai_messages_conversation_seq ON ai_messages(conversation_id,seq);
