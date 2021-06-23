import axios from "axios";
import { PlotData, preparePlotData } from "./seriesCalc";

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

  async getSeriesData(instance: string): Promise<PlotData> {
    const r = await client.get(`/series/by_instance/${instance}`);
    const data = preparePlotData(r.data);
    console.log(data);
    return data;
  },
};
