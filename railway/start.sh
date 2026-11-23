#!/bin/sh
# Railway mounts volumes owned by root. Make the upload folder writable, then drop to the unprivileged
# `node` user for the app itself.
set -e
mkdir -p "$LOCAL_UPLOAD_DIR"
chown -R node:node "$LOCAL_UPLOAD_DIR"
# Migrations run on API start. Demo data is created once (the seed skips when users already exist).
if [ "$SEED_DEMO_DATA" = "true" ]; then gosu node node dist/db/seed.js; fi
# Sample jobs, resumes and applications (samples/). Loaded on the first deploy only: once the sample employer
# exists this is a no-op. Set LOAD_SAMPLE_DATA=false to skip.
if [ "$LOAD_SAMPLE_DATA" = "true" ]; then gosu node node dist/db/samples.js || echo "Warning: sample data not loaded; starting anyway"; fi
exec gosu node node dist/index.js
