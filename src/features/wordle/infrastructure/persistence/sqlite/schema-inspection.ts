import type { DatabaseSync } from "node:sqlite";

interface PersistedTableName {
    name: string;
}

export interface PersistedTableColumn {
    name: string;
    pk: number;
}

export function tableExists(database: DatabaseSync, tableName: string): boolean {
    const row = database
        .prepare(
            `
                SELECT name
                FROM sqlite_master
                WHERE type = 'table' AND name = ?
            `,
        )
        .get(tableName) as PersistedTableName | undefined;

    return row !== undefined;
}
