-- Shop news is independent of loyalty membership and promotion pricing.
CREATE TABLE shop_news (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores(id),
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
 body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 4000),
 published boolean NOT NULL DEFAULT false,
 published_at timestamptz,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (NOT published OR published_at IS NOT NULL)
);
CREATE INDEX shop_news_store_created ON shop_news(store_id,created_at DESC,id DESC);
CREATE INDEX shop_news_published ON shop_news(published_at DESC,id DESC) WHERE published;
