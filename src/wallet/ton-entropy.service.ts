import { createHash, randomUUID } from "crypto";

export class TonEntropyService {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async getClientSeed(): Promise<string> {
    try {
      const last = await this.fetchMasterchainLastBlock();
      if (!last?.root_hash || !last.file_hash || typeof last.seqno !== "number") {
        throw new Error("Unexpected TON masterchain payload");
      }

      // Public chain data acts as external entropy for provably fair seed mix.
      return `${last.seqno}:${last.root_hash}:${last.file_hash}`;
    } catch {
      // Fallback keeps service operational, but production should monitor TON API availability.
      const fallback = `${Date.now()}:${randomUUID()}`;
      return createHash("sha256").update(fallback).digest("hex");
    }
  }

  private async fetchMasterchainLastBlock(): Promise<
    | {
        seqno?: number;
        root_hash?: string;
        file_hash?: string;
      }
    | undefined
  > {
    const normalizedBase = this.baseUrl.trim().replace(/\/+$/, "");

    if (/\/jsonrpc$/i.test(normalizedBase)) {
      return this.fetchMasterchainViaJsonRpc(normalizedBase);
    }

    return this.fetchMasterchainViaRest(normalizedBase);
  }

  private async fetchMasterchainViaRest(baseUrl: string) {
    const url = new URL("getMasterchainInfo", `${baseUrl}/`);
    if (this.apiKey) {
      url.searchParams.set("api_key", this.apiKey);
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`TON API error: ${response.status}`);
    }

    const payload = (await response.json()) as {
      result?: {
        last?: {
          seqno?: number;
          root_hash?: string;
          file_hash?: string;
        };
      };
    };

    return payload.result?.last;
  }

  private async fetchMasterchainViaJsonRpc(jsonRpcUrl: string) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json"
    };

    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    const response = await fetch(jsonRpcUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "getMasterchainInfo",
        params: {}
      })
    });

    if (!response.ok) {
      throw new Error(`TON JSON-RPC error: ${response.status}`);
    }

    const payload = (await response.json()) as {
      result?: {
        last?: {
          seqno?: number;
          root_hash?: string;
          file_hash?: string;
        };
      };
      error?: unknown;
    };

    if (payload.error) {
      throw new Error("TON JSON-RPC returned an error");
    }

    return payload.result?.last;
  }
}
