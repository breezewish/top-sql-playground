package model

import (
	"encoding/hex"
	"fmt"
	"sort"
	"sync"

	"github.com/golang/protobuf/proto"
	tikvpb "github.com/pingcap/kvproto/pkg/resource_usage_agent"
	tidbpb "github.com/pingcap/tipb/go-tipb"
)

type Value struct {
	Timestamp uint64
	CPUInMS   uint64
}

type TimeSeries struct {
	Instance   string
	SQLDigest  string
	PlanDigest string
	// Timestamps are not ordered, and may even duplicated.
	UnorderedValues []Value
	valuesSum       uint64
}

func makeKey(instance string, sqlDigest string, planDigest string) string {
	return instance + "_" + sqlDigest + "_" + planDigest
}

type TimeSeriesData struct {
	sync.Mutex
	seriesByKey map[string]*TimeSeries
}

func NewTimeSeriesData() *TimeSeriesData {
	return &TimeSeriesData{
		Mutex:          sync.Mutex{},
		seriesByKey: map[string]*TimeSeries{},
	}
}

// Thread-safe
func (tsd *TimeSeriesData) ingest(
	instance string, sqlDigest string, planDigest string,
	timestamps []uint64,
	cpuValues []uint32) error {

	tsd.Lock()
	defer tsd.Unlock()

	if len(timestamps) != len(cpuValues) {
		return fmt.Errorf("data corrupted, TimestampList len = %d, CpuTimeMsList len = %d",
			len(timestamps),
			len(cpuValues))
	}
	if len(sqlDigest) == 0 {
		return fmt.Errorf("data corrupted, SqlDigest len = 0")
	}

	key := makeKey(instance, sqlDigest, planDigest)

	series, ok := tsd.seriesByKey[key]
	if !ok {
		series = &TimeSeries{
			Instance:        instance,
			SQLDigest:       sqlDigest,
			PlanDigest:      planDigest,
			UnorderedValues: make([]Value, 0, 100),
			valuesSum:       0,
		}
		tsd.seriesByKey[key] = series
	}

	var s uint64
	l := len(timestamps)
	for i := 0; i < l; i++ {
		series.UnorderedValues = append(series.UnorderedValues, Value{
			Timestamp: timestamps[i],
			CPUInMS:   uint64(cpuValues[i]),
		})
		s += uint64(cpuValues[i])
	}
	series.valuesSum += s

	return nil
}

// Thread-safe
func (tsd *TimeSeriesData) IngestTiDBData(instance string, data *tidbpb.CPUTimeRecord) error {
	sqlDigest := hex.EncodeToString(data.SqlDigest)
	planDigest := hex.EncodeToString(data.PlanDigest)
	return tsd.ingest(instance, sqlDigest, planDigest, data.TimestampList, data.CpuTimeMsList)
}

// Thread-safe
func (tsd *TimeSeriesData) IngestTiKVData(instance string, data *tikvpb.ReportCpuTimeRequest) error {
	if len(data.ResourceGroupTag) == 0 {
		return fmt.Errorf("data corrupted, ResourceTag len = 0")
	}
	tag := &tidbpb.ResourceGroupTag{}
	err := proto.Unmarshal(data.ResourceGroupTag, tag)
	if err != nil {
		return fmt.Errorf("unmarshal resource group tag failed: %v", err.Error())
	}

	sqlDigest := hex.EncodeToString(tag.SqlDigest)
	planDigest := hex.EncodeToString(tag.PlanDigest)
	return tsd.ingest(instance, sqlDigest, planDigest, data.RecordListTimestampSec, data.RecordListCpuTimeMs)
}

// Thread-safe
func (tsd *TimeSeriesData) GetInstances() []string {
	instances := make(map[string]struct{})

	tsd.Lock()
	for _, ts := range tsd.seriesByKey {
		instances[ts.Instance] = struct{}{}
	}
	defer tsd.Unlock()

	result := make([]string, 0, 50)
	for instance := range instances {
		result = append(result, instance)
	}

	sort.Strings(result)
	return result
}

// Thread-safe. The returned data structure is not thread-safe.
func (tsd *TimeSeriesData) GetDataInInstance(instance string) []*TimeSeries {
	results := make([]*TimeSeries, 0, 50)

	tsd.Lock()
	for _, ts := range tsd.seriesByKey {
		if ts.Instance != instance {
			continue
		}
		results = append(results, ts)
	}
	defer tsd.Unlock()

	return results
}

type DigestRegistry struct {
	sync.Mutex
	planMap map[string]string
	sqlMap  map[string]string
}

func NewDigestRegistry() *DigestRegistry {
	return &DigestRegistry{
		Mutex: sync.Mutex{},
		planMap: map[string]string{},
		sqlMap:  map[string]string{},
	}
}

// Thread-safe
func (r *DigestRegistry) LinkPlan(digest, text string) {
	r.Lock()
	defer r.Unlock()

	r.planMap[digest] = text
}

// Thread-safe
func (r *DigestRegistry) LinkSQL(digest, text string) {
	r.Lock()
	defer r.Unlock()

	r.sqlMap[digest] = text
}

// Thread-safe. The returned data structure is not thread-safe.
func (r *DigestRegistry) GetSQLMap() map[string]string {
	return r.sqlMap
}
