import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { migrateWordleSchema } from "./schema.js";

export interface WordleDatabaseOptions {
    databasePath?: string;
}

export class WordleDatabase {
    public readonly connection: DatabaseSync;
    private closed = false;

    public constructor(options: WordleDatabaseOptions = {}) {
        const requestedPath = options.databasePath ?? ":memory:";
        const databasePath = requestedPath === ":memory:" ? requestedPath : resolve(requestedPath);

        if (databasePath !== ":memory:") {
            mkdirSync(dirname(databasePath), { recursive: true });
        }

        this.connection = new DatabaseSync(databasePath);
        this.connection.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
        `);
        migrateWordleSchema(this.connection);
        this.connection.exec("PRAGMA foreign_keys = ON;");
    }

    public runTransaction<T>(operation: () => T): T {
        this.connection.exec("BEGIN IMMEDIATE");

        try {
            const result = operation();
            this.connection.exec("COMMIT");
            return result;
        } catch (error) {
            this.connection.exec("ROLLBACK");
            throw error;
        }
    }

    public close(): void {
        if (this.closed) {
            return;
        }

        this.connection.close();
        this.closed = true;
    }
}
