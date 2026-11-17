// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_curious_stryfe.sql';
import m0001 from './0001_seed_default_categories.sql';
import m0002 from './0002_flowery_falcon.sql';
import m0003 from './0003_protect_default_categories.sql';
import m0004 from './0004_budget_scopes.sql';
import m0005 from './0005_sync_tracking.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005
    }
  }
  