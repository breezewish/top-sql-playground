import { Box, Flex, Select } from "@chakra-ui/react";
import useResizeObserver from "@react-hook/resize-observer";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "react-query";
import uPlot from "uplot";
import { api } from "./utils/api";

function useSeriesData(instance: string) {
  return useQuery(
    ["getSeriesData", instance],
    () => api.getSeriesData(instance),
    {
      enabled: instance.length > 0,
      refetchOnWindowFocus: false,
    }
  );
}

function columnHighlightPlugin({
  className,
  style = { backgroundColor: "rgba(51,204,255,0.3)" },
}: any = {}): uPlot.Plugin {
  let underEl, overEl, highlightEl: HTMLDivElement, currIdx: any;

  function init(u: uPlot) {
    underEl = u.under;
    overEl = u.over;

    highlightEl = document.createElement("div");
    className && highlightEl.classList.add(className);

    uPlot.assign(highlightEl.style, {
      pointerEvents: "none",
      display: "none",
      position: "absolute",
      left: 0,
      top: 0,
      height: "100%",
      ...style,
    });

    underEl.appendChild(highlightEl);

    // show/hide highlight on enter/exit
    overEl.addEventListener("mouseenter", () => {
      highlightEl.style.display = "";
    });
    overEl.addEventListener("mouseleave", () => {
      highlightEl.style.display = "none";
    });
  }

  function update(u: uPlot) {
    if (currIdx !== u.cursor.idx) {
      currIdx = u.cursor.idx;

      const dx = (u.scales.x.max ?? 0) - (u.scales.x.min ?? 0);
      const width = Math.max(
        u.bbox.width / dx / devicePixelRatio,
        devicePixelRatio
      );
      const xVal = u.data[0][currIdx];
      const left = u.valToPos(xVal, "x") - width;

      highlightEl.style.transform = "translateX(" + Math.floor(left) + "px)";
      highlightEl.style.width = Math.floor(width) + "px";
    }
  }

  function destroy(u: uPlot) {
    highlightEl.remove();
  }

  return {
    hooks: {
      init,
      destroy,
      setCursor: update,
    },
  };
}

const colorPalette = [
  "#2ec7c9",
  "#b6a2de",
  "#5ab1ef",
  "#ffb980",
  "#d87a80",
  "#8d98b3",
  "#e5cf0d",
  "#97b552",
  "#95706d",
  "#dc69aa",
  "#07a2a4",
  "#9a7fd1",
  "#588dd5",
  "#f5994e",
  "#c05050",
  "#59678c",
  "#c9ab00",
  "#7eb00a",
  "#6f5553",
  "#c14089",
];

function stack(data: (number | null)[][], omit: (i: number) => boolean) {
  if (data.length === 0) {
    return {
      data: [],
      bands: [],
    };
  }

  let data2 = [];
  let bands = [];
  let d0Len = data[0].length;
  let accum = Array(d0Len);

  for (let i = 0; i < d0Len; i++) accum[i] = 0;

  for (let i = 1; i < data.length; i++)
    data2.push(
      omit(i) ? data[i] : data[i].map((v, i) => (accum[i] += +(v ?? 0)))
    );

  for (let i = 1; i < data.length; i++)
    !omit(i) &&
      bands.push({
        series: [data.findIndex((s, j) => j > i && !omit(j)), i],
      });

  bands = bands.filter((b) => b.series[1] > -1);

  return {
    data: [data[0]].concat(data2),
    bands,
  };
}

function App() {
  const { data: instances } = useQuery("getInstances", api.getInstances);
  const [instance, setInstance] = useState<string | null>(null);
  const { data: seriesData } = useSeriesData(instance ?? "");

  const handleInstanceChange = useCallback((e) => {
    setInstance(e.target.value);
  }, []);

  const plotContainer = useRef(null);
  const plot = useRef(null);
  const plotInstance = useRef<uPlot | null>(null);
  const plotSize = useRef<[number, number] | null>(null);

  useEffect(() => {
    const p = new uPlot(
      {
        width: 0,
        height: 0,
        series: [],
      },
      [[], []],
      plot.current!
    );
    plotInstance.current = p;

    return () => {
      plotInstance.current!.destroy();
    };
  }, []);

  useResizeObserver(plotContainer, (entry) => {
    plotSize.current = [entry.contentRect.width, entry.contentRect.height - 50];
    plotInstance.current!.setSize({
      width: plotSize.current[0],
      height: plotSize.current[1],
    });
  });

  useEffect(() => {
    plotInstance.current!.destroy();

    const data: (number | null)[][] = [];
    const series: uPlot.Series[] = [{}];
    if (seriesData) {
      data.push(seriesData.timestamps);
      seriesData.series.forEach((s, i) => {
        data.push(s.data);
        series.push({
          fill: colorPalette[i % colorPalette.length],
          stroke: colorPalette[i % colorPalette.length],
          value: (u, v, si, i) => data[si][i]!,
          label: `${s.sqlDigest.slice(0, 5)}_${
            s.planDigest?.slice(0, 5) ?? "(None)"
          }`,
          paths: uPlot.paths.bars!({ size: [1], align: -1 }),
          points: {
            show: false,
          },
        });
      });
    }

    const stacked = stack(data, (_) => false);
    plotInstance.current = new uPlot(
      {
        width: plotSize.current?.[0] ?? 0,
        height: plotSize.current?.[1] ?? 0,
        series,
        plugins: [columnHighlightPlugin()],
        bands: stacked.bands as any,
        cursor: {
          points: {
            show: false,
          },
        },
      },
      // data as any,
      stacked.data as any,
      plot.current!
    );

    console.log(seriesData);
  }, [seriesData]);

  return (
    <Flex direction="column" height="100%">
      <Box>
        <Select placeholder="Select Instance" onChange={handleInstanceChange}>
          {instances &&
            instances.map((i) => (
              <option value={i} key={i}>
                {i}
              </option>
            ))}
        </Select>
      </Box>
      <Box flexGrow={1} ref={plotContainer} marginTop={8}>
        <Box position="absolute" ref={plot}></Box>
      </Box>
    </Flex>
  );
}

export default App;
