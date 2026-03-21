import fs from "node:fs";
import { config } from "./config.js";

export class JsonStore {
  #data;

  constructor(filePath = config.paths.db) {
    this.filePath = filePath;
    this.#data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
  }

  read() {
    return structuredClone(this.#data);
  }

  mutate(mutator) {
    const draft = structuredClone(this.#data);
    const result = mutator(draft) ?? draft;
    this.#data = result;
    fs.writeFileSync(this.filePath, JSON.stringify(this.#data, null, 2));
    return structuredClone(this.#data);
  }
}
