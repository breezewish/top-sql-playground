import { GetSeriesDataResponse } from "./api";

// Merge two series to generate a timestamp
function mergeTwoTimestamps(a?: number[], b?: number[]): number[] | undefined {
  if (!a || !b) {
    if (a) {
      return a;
    } else {
      return b;
    }
  }

  let ptrA = 0;
  let ptrB = 0;
  const lenA = a.length;
  const lenB = b.length;

  const result = [];
  let lastResult: number | null = null;
  let validResults = 0;
  result.length = a.length + b.length;

  while (ptrA < lenA || ptrB < lenB) {
    let cur;
    if (ptrA === lenA) {
      cur = b[ptrB];
      ptrB++;
    } else if (ptrB === lenB) {
      cur = a[ptrA];
      ptrA++;
    } else if (a[ptrA] < b[ptrB]) {
      cur = a[ptrA];
      ptrA++;
    } else {
      cur = b[ptrB];
      ptrB++;
    }
    if (cur !== lastResult) {
      result[validResults] = cur;
      lastResult = cur;
      validResults++;
    }
  }

  // truncate unnecessary values
  result.length = validResults;
  return result;
}

function mergeTimestamps(
  timestampsForSeries: number[][],
  l: number,
  r: number
): number[] | undefined {
  if (l === r) {
    return timestampsForSeries[l];
  }
  if (l > r) {
    return undefined;
  }
  const mid = Math.floor((l + r) / 2);
  return mergeTwoTimestamps(
    mergeTimestamps(timestampsForSeries, l, mid),
    mergeTimestamps(timestampsForSeries, mid + 1, r)
  );
}

export type PlotSeries = {
  sqlDigest: string;
  planDigest: string | null;
  data: (number | null)[];
};

export type PlotData = {
  timestamps: number[];
  series: PlotSeries[];
};

export function preparePlotData(data: GetSeriesDataResponse): PlotData {
  if (data.length === 0) {
    return {
      timestamps: [],
      series: [],
    };
  }

  // 0. Sort data
  data.sort((a, b) => {
    const c = a.SQLDigest.localeCompare(b.SQLDigest);
    if (c !== 0) {
      return c;
    }
    return (a.PlanDigest ?? "").localeCompare(b.PlanDigest ?? "");
  });

  // 1. Sort values for each series
  data.forEach((series) => {
    series.UnorderedValues.sort((a, b) => {
      return a.Timestamp - b.Timestamp;
    });
  });

  // 2. Extract timestamps
  const timestampsForSeries: number[][] = [];
  data.forEach((series) => {
    const timestamps: number[] = [];
    const len = series.UnorderedValues.length;
    timestamps.length = len; // Pre-allocate
    for (let i = 0; i < len; i++) {
      timestamps[i] = series.UnorderedValues[i].Timestamp;
    }
    timestampsForSeries.push(timestamps);
  });

  // 3. Merge timestamps
  let mergedTimestamps = mergeTimestamps(
    timestampsForSeries,
    0,
    timestampsForSeries.length - 1
  );

  // 4. Re-align data points according to the merged timestamp
  const plotSeries: PlotSeries[] = [];
  data.forEach((series) => {
    const lenSrc = series.UnorderedValues.length;
    const lenDest = mergedTimestamps!.length;

    const data: (number | null)[] = [];
    data.length = lenDest;
    for (let i = 0; i < lenDest; i++) {
      data[i] = null;
    }

    let ptrSrc = 0;
    for (let ptrDest = 0; ptrDest < lenDest; ptrDest++) {
      const currentTs = mergedTimestamps![ptrDest];
      let src = series.UnorderedValues[ptrSrc];
      while (ptrSrc < lenSrc && src && src.Timestamp < currentTs) {
        // TODO: Do binary search to advance the ptrSrc
        ptrSrc++;
        src = series.UnorderedValues[ptrSrc];
      }
      if (src?.Timestamp === currentTs) {
        data[ptrDest] = src.CPUInMS;
        ptrSrc++;
      }
      // Src is drained, no need to iterate any more.
      if (ptrSrc >= lenSrc) {
        break;
      }
    }

    plotSeries.push({
      sqlDigest: series.SQLDigest,
      planDigest: series.PlanDigest,
      data,
    });
  });

  return {
    timestamps: mergedTimestamps!,
    series: plotSeries,
  };
}
