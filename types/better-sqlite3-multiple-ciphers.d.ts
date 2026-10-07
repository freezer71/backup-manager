// Le package fournit index.d.ts, mais son champ "exports" le masque à TypeScript.
// Ce shim le ré-expose par type, sans mapping `paths` (qui ferait résoudre le module
// vers le .d.ts à l'exécution dans Next).
declare module "better-sqlite3-multiple-ciphers" {
  type Impl = typeof import("../node_modules/better-sqlite3-multiple-ciphers/index.d.ts");
  const Database: Impl;
  namespace Database {
    type Database = InstanceType<Impl>;
  }
  export = Database;
}
