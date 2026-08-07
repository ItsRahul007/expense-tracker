import journal from './meta/_journal.json';
import m0000 from './0000_curious_stryfe.sql';
import m0001 from './0001_seed_default_categories.sql';
import m0002 from './0002_flowery_falcon.sql';
import m0003 from './0003_protect_default_categories.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003
    }
  }
  