declare module "better-sqlite3" {
  interface Database {
    exec(sql: string): void;
    prepare(sql: string): Statement;
  }

  interface Statement {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  interface DatabaseConstructor {
    new (path: string): Database;
  }

  const Database: DatabaseConstructor;
  export = Database;
}
