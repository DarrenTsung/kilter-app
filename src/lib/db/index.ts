import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface KilterDB extends DBSchema {
  climbs: {
    key: string;
    value: {
      uuid: string;
      layout_id: number;
      setter_id: number;
      setter_username: string;
      name: string;
      description: string;
      frames: string;
      frames_count: number;
      is_draft: number;
      is_listed: number;
      edge_left: number;
      edge_right: number;
      edge_bottom: number;
      edge_top: number;
      angle: number;
      // Pre-computed at sync time
      has_aux_hold?: boolean;
      has_aux_hand_hold?: boolean;
    };
    indexes: {
      "by-layout": number;
    };
  };
  climb_stats: {
    key: [string, number]; // [climb_uuid, angle]
    value: {
      climb_uuid: string;
      angle: number;
      display_difficulty: number;
      benchmark_difficulty: number | null;
      ascensionist_count: number;
      difficulty_average: number;
      quality_average: number;
      fa_username: string;
      fa_at: string;
    };
    indexes: {
      "by-climb": string;
      "by-angle": number;
    };
  };
  placements: {
    key: number;
    value: {
      id: number;
      layout_id: number;
      hole_id: number;
      set_id: number;
      default_placement_role_id: number;
    };
    indexes: {
      "by-layout": number;
      "by-set": number;
    };
  };
  holes: {
    key: number;
    value: {
      id: number;
      product_id: number;
      name: string;
      x: number;
      y: number;
      mirrored_hole_id: number | null;
    };
  };
  leds: {
    key: number;
    value: {
      id: number;
      product_size_id: number;
      hole_id: number;
      position: number;
    };
    indexes: {
      "by-product-size": number;
      "by-hole": number;
    };
  };
  placement_roles: {
    key: number;
    value: {
      id: number;
      product_id: number;
      position: number;
      name: string;
      full_name: string;
      led_color: string;
      screen_color: string;
    };
  };
  difficulty_grades: {
    key: number;
    value: {
      difficulty: number;
      boulder_name: string;
      route_name: string;
      is_listed: number;
    };
  };
  product_sizes_layouts_sets: {
    key: number;
    value: {
      id: number;
      product_size_id: number;
      layout_id: number;
      set_id: number;
      image_filename: string;
      is_listed: number;
    };
  };
  ascents: {
    key: string;
    value: {
      uuid: string;
      climb_uuid: string;
      angle: number;
      is_mirror: number;
      user_id: number;
      attempt_id: number;
      bid_count: number;
      quality: number;
      difficulty: number;
      is_benchmark: number;
      comment: string;
      climbed_at: string;
      created_at: string;
    };
    indexes: {
      "by-climb": string;
      "by-user": number;
    };
  };
  circuits: {
    key: string;
    value: {
      uuid: string;
      name: string;
      description: string;
      color: string;
      user_id: number;
      is_public: number;
      created_at: string;
      updated_at: string;
    };
    indexes: {
      "by-user": number;
    };
  };
  circuits_climbs: {
    key: [string, string]; // [circuit_uuid, climb_uuid]
    value: {
      circuit_uuid: string;
      climb_uuid: string;
      position: number;
    };
    indexes: {
      "by-circuit": string;
      "by-climb": string;
    };
  };
  sync_state: {
    key: string;
    value: {
      table_name: string;
      last_synchronized_at: string;
    };
  };
}

const DB_NAME = "kilter-app";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<KilterDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<KilterDB>> {
  if (!dbPromise) {
    dbPromise = openDB<KilterDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          // Climbs
          const climbStore = db.createObjectStore("climbs", {
            keyPath: "uuid",
          });
          climbStore.createIndex("by-layout", "layout_id");

          // Climb stats (compound key)
          const statsStore = db.createObjectStore("climb_stats", {
            keyPath: ["climb_uuid", "angle"],
          });
          statsStore.createIndex("by-climb", "climb_uuid");
          statsStore.createIndex("by-angle", "angle");

          // Placements
          const placementStore = db.createObjectStore("placements", {
            keyPath: "id",
          });
          placementStore.createIndex("by-layout", "layout_id");
          placementStore.createIndex("by-set", "set_id");

          // Holes
          db.createObjectStore("holes", { keyPath: "id" });

          // LEDs
          const ledStore = db.createObjectStore("leds", { keyPath: "id" });
          ledStore.createIndex("by-product-size", "product_size_id");
          ledStore.createIndex("by-hole", "hole_id");

          // Placement roles
          db.createObjectStore("placement_roles", { keyPath: "id" });

          // Difficulty grades
          db.createObjectStore("difficulty_grades", { keyPath: "difficulty" });

          // Product sizes layouts sets
          db.createObjectStore("product_sizes_layouts_sets", { keyPath: "id" });

          // Ascents
          const ascentStore = db.createObjectStore("ascents", {
            keyPath: "uuid",
          });
          ascentStore.createIndex("by-climb", "climb_uuid");
          ascentStore.createIndex("by-user", "user_id");

          // Sync state tracking
          db.createObjectStore("sync_state", { keyPath: "table_name" });
        }

        if (oldVersion < 2) {
          // Circuits
          const circuitStore = db.createObjectStore("circuits", {
            keyPath: "uuid",
          });
          circuitStore.createIndex("by-user", "user_id");

          // Circuit-climb junction table
          const ccStore = db.createObjectStore("circuits_climbs", {
            keyPath: ["circuit_uuid", "climb_uuid"],
          });
          ccStore.createIndex("by-circuit", "circuit_uuid");
          ccStore.createIndex("by-climb", "climb_uuid");
        }
      },
    });
  }
  return dbPromise;
}
