declare module 'better-sqlite3' {
  export interface Database {
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }

  export interface Statement {
    run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }

  export default function BetterSqlite3(filename: string): Database;
}