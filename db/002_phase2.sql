-- Phase 2: match results and per-display-name leaderboard (no authentication yet).
CREATE TABLE IF NOT EXISTS phase2_matches (
 id UUID PRIMARY KEY,
 room_code VARCHAR(16) NOT NULL,
 started_at TIMESTAMPTZ NOT NULL,
 ended_at TIMESTAMPTZ NOT NULL,
 reason VARCHAR(32) NOT NULL,
 winner_name VARCHAR(40),
 draw BOOLEAN NOT NULL
);
CREATE TABLE IF NOT EXISTS phase2_match_scores (
 match_id UUID NOT NULL REFERENCES phase2_matches(id) ON DELETE CASCADE,
 player_id VARCHAR(128) NOT NULL,
 player_name VARCHAR(40) NOT NULL,
 score INTEGER NOT NULL CHECK(score >= 0),
 deaths INTEGER NOT NULL CHECK(deaths >= 0),
 shots INTEGER NOT NULL CHECK(shots >= 0),
 hits INTEGER NOT NULL CHECK(hits >= 0),
 won BOOLEAN NOT NULL,
 PRIMARY KEY(match_id,player_id)
);
CREATE INDEX IF NOT EXISTS idx_phase2_scores_name ON phase2_match_scores(player_name);
