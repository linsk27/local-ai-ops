import { BarChart, GaugeChart, GraphChart, PieChart, SankeyChart } from "echarts/charts";
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([BarChart, GaugeChart, GraphChart, PieChart, SankeyChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

export default function EChart({ option }: { option: EChartsOption }): JSX.Element {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }
    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    chart.setOption(option, true);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(chartRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [option]);

  return <div className="chart-frame" ref={chartRef} role="img" />;
}
