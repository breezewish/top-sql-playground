import axios from "axios";

const client = axios.create({
  baseURL: "http://127.0.0.1:14000",
});

export type GetInstanceResponse = string[];

export type Value = {
  Timestamp: number;
  CPUInMS: number;
};

export type Series = {
  Instance: string;
  PlanDigest: string | null;
  SQLDigest: string;
  UnorderedValues: Value[];
};

export type GetSeriesDataResponse = Series[];

export const api = {
  async getInstances(): Promise<GetInstanceResponse> {
    const r = await client.get("/series/all");
    return r.data;
  },

  async getSeriesData(instance: string): Promise<GetSeriesDataResponse> {
    const r = await client.get(`/series/by_instance/${instance}`);
    const data = r.data as GetSeriesDataResponse;

    // 1. Sort data
    data.sort((a, b) => {
      const c = a.SQLDigest.localeCompare(b.SQLDigest);
      if (c !== 0) {
        return c;
      }
      return (a.PlanDigest ?? "").localeCompare(b.PlanDigest ?? "");
    });

    // 2. Sort values for each series
    data.forEach((series) => {
      series.UnorderedValues.sort((a, b) => {
        return a.Timestamp - b.Timestamp;
      });
    });

    // 3. Deduplicate
    data.forEach((series) => {
      let lastTimestamp: number | null = null;
      const sortedValues: Value[] = [];
      series.UnorderedValues.forEach((v) => {
        if (v.Timestamp === lastTimestamp) {
          return;
        }
        sortedValues.push({
          ...v,
          Timestamp: v.Timestamp * 1000, // Convert to ms
        });
        lastTimestamp = v.Timestamp;
      });
      series.UnorderedValues = sortedValues;
    });

    return data;
  },

  async getDigestMap(): Promise<Record<string, string>> {
    const r = await client.get(`/digests/sql`);
    return r.data;
  },
};
