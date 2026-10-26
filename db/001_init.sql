CREATE TABLE IF NOT EXISTS players (
 id UUID PRIMARY KEY,
 display_name VARCHAR(40) NOT NULL,
 wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
 losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
 total_score INTEGER NOT NULL DEFAULT 0 CHECK (total_score >= 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS matches (
 id UUID PRIMARY KEY,
 room_code VARCHAR(16) NOT NULL,
 started_at TIMESTAMPTZ NOT NULL,
 ended_at TIMESTAMPTZ,
 winner_id UUID REFERENCES players(id),
 status VARCHAR(20) NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS match_participants (
 match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
 player_id UUID NOT NULL REFERENCES players(id),
 score INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(match_id,player_id)
);
