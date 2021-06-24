import { Box, Button, Flex, HStack, Select } from "@chakra-ui/react";
import {
  Axis,
  BarSeries,
  Chart,
  niceTimeFormatByDay,
  Position,
  ScaleType,
  Settings,
  timeFormatter,
  XYBrushArea,
} from "@elastic/charts";
import { orderBy, toPairs } from "lodash";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "react-query";
import { api } from "./utils/api";

function useSeriesData(instance: string) {
  return useQuery(
    ["getSeriesData", instance],
    () => api.getSeriesData(instance),
    {
      enabled: instance.length > 0,
      refetchOnWindowFocus: false,
      refetchInterval: 5000,
    }
  );
}

function useDigestMap() {
  return useQuery("getDigestMap", api.getDigestMap, {
    refetchOnWindowFocus: false,
    refetchInterval: 5000,
  });
}

const formatter = timeFormatter(niceTimeFormatByDay(1));
const fullFormatter = timeFormatter("YYYY-MM-DD HH:mm:ss");

function App() {
  const { data: instances } = useQuery("getInstances", api.getInstances);
  const [instance, setInstance] = useState<string | null>(null);
  const { data: seriesData } = useSeriesData(instance ?? "");
  const [timeRange, setTimeRange] = useState<[number, number] | null>(null);
  const { data: digestMap } = useDigestMap();

  const handleInstanceChange = useCallback((e) => {
    setInstance(e.target.value);
  }, []);

  const plotContainer = useRef(null);

  const handleBrushEnd = useCallback((v: XYBrushArea) => {
    if (v.x) {
      setTimeRange(v.x);
    }
  }, []);

  const handleResetTimeRange = useCallback(() => {
    setTimeRange(null);
  }, []);

  const chartData = useMemo(() => {
    if (!seriesData) {
      return {};
    }
    // Group by SQL digest + timestamp and sum their values
    const valuesByDigestAndTs: Record<string, Record<number, number>> = {};
    const sumValueByDigest: Record<string, number> = {};
    seriesData.forEach((series) => {
      if (!valuesByDigestAndTs[series.SQLDigest]) {
        valuesByDigestAndTs[series.SQLDigest] = {};
      }
      const map = valuesByDigestAndTs[series.SQLDigest];
      let sum = 0;
      series.UnorderedValues.forEach((values) => {
        if (
          timeRange &&
          (values.Timestamp < timeRange[0] || values.Timestamp > timeRange[1])
        ) {
          return;
        }
        if (!map[values.Timestamp]) {
          map[values.Timestamp] = values.CPUInMS;
        } else {
          map[values.Timestamp] += values.CPUInMS;
        }
        sum += values.CPUInMS;
      });
      if (!sumValueByDigest[series.SQLDigest]) {
        sumValueByDigest[series.SQLDigest] = sum;
      } else {
        sumValueByDigest[series.SQLDigest] += sum;
      }
    });

    // Order by digest
    const orderedDigests = orderBy(
      toPairs(sumValueByDigest),
      ["1"],
      ["desc"]
    ).map((v) => v[0]);

    const datumByDigest: Record<string, Array<[number, number]>> = {};
    for (const digest of orderedDigests) {
      const datum: Array<[number, number]> = [];

      const valuesByTs = valuesByDigestAndTs[digest];
      for (const ts in valuesByTs) {
        const value = valuesByTs[ts];
        datum.push([Number(ts), value]);
      }

      datumByDigest[digest] = datum;
    }

    return datumByDigest;
  }, [seriesData, timeRange]);

  return (
    <Flex direction="column" height="100%">
      <Box>
        <HStack spacing="8px">
          <Box>
            <Select
              placeholder="Select Instance"
              onChange={handleInstanceChange}
            >
              {instances &&
                instances.map((i) => (
                  <option value={i} key={i}>
                    {i}
                  </option>
                ))}
            </Select>
          </Box>
          <Box>
            {timeRange && (
              <Button
                variant="outline"
                colorScheme="blue"
                onClick={handleResetTimeRange}
              >
                Reset Time Range (now: {fullFormatter(timeRange[0])} ~{" "}
                {fullFormatter(timeRange[1])})
              </Button>
            )}
          </Box>
        </HStack>
      </Box>
      <Box ref={plotContainer} marginTop={8} height={600}>
        <Chart>
          <Settings
            showLegend
            legendPosition={Position.Right}
            onBrushEnd={handleBrushEnd}
          />
          <Axis
            id="bottom"
            position={Position.Bottom}
            showOverlappingTicks
            tickFormat={formatter}
          />
          <Axis id="left" position={Position.Left} />
          {Object.keys(chartData).map((digest) => {
            return (
              <BarSeries
                key={digest}
                id={digest}
                xScaleType={ScaleType.Time}
                yScaleType={ScaleType.Linear}
                xAccessor={0}
                yAccessors={[1]}
                stackAccessors={[0]}
                data={chartData[digest]}
                name={digestMap?.[digest]?.slice(0, 50) ?? digest.slice(0, 6)}
              />
            );
          })}
        </Chart>
      </Box>
    </Flex>
  );
}

export default App;
