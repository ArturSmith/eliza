-- Campaign cards advertise actual promotions, independently of loyalty programs.
-- Preserve legacy standalone loyalty_campaigns records; they are no longer published.
CREATE TABLE promotion_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL,
 promotion_id uuid NOT NULL,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 2000),
 published boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(promotion_id,store_id),
 FOREIGN KEY(promotion_id,store_id) REFERENCES promotions(id,store_id)
);
CREATE INDEX promotion_campaigns_published ON promotion_campaigns(store_id) WHERE published;
