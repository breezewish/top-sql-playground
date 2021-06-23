package main

import (
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"time"

	"topsqlMockAgent/model"

	"github.com/gin-contrib/cors"
	"github.com/gin-contrib/zap"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"google.golang.org/grpc"

	tikvpb "github.com/pingcap/kvproto/pkg/resource_usage_agent"
	tidbpb "github.com/pingcap/tipb/go-tipb"
)

var (
	grpcListen = flag.String("grpc-listen", "127.0.0.1:10091", "The gRPC service listen host and port")
	grpcServices = flag.Int("count", 20, "The number of gRPC service to start")
	uiAPIListen = flag.String("ui-listen", "127.0.0.1:14000", "The UI API service listen host and port")

	data = model.NewTimeSeriesData()
	digestRegistry = model.NewDigestRegistry()
)

type tidbCollectServer struct {
	port int
}

func (s *tidbCollectServer) ReportSQLMeta(stream tidbpb.TopSQLAgent_ReportSQLMetaServer) error {
	zap.L().Info("Receive TiDB SQL Meta Stream")
	startTs := time.Now()

	statsDigests := 0
	for {
		req, err := stream.Recv()
		if err == io.EOF {
			break
		} else if err != nil {
			return err
		}

		if len(req.SqlDigest) > 0 {
			statsDigests += 1
			digestRegistry.LinkPlan(hex.EncodeToString(req.SqlDigest), req.NormalizedSql)
		}
	}

	zap.L().Info("TiDB SQL Meta Ingested",
		zap.Int("digests", statsDigests),
		zap.Duration("elapsed", time.Since(startTs)))
	resp := &tidbpb.EmptyResponse{}
	return stream.SendAndClose(resp)
}

func (s *tidbCollectServer) ReportPlanMeta(stream tidbpb.TopSQLAgent_ReportPlanMetaServer) error {
	zap.L().Info("Receive TiDB Plan Meta Stream")
	startTs := time.Now()

	statsDigests := 0
	for {
		req, err := stream.Recv()
		if err == io.EOF {
			break
		} else if err != nil {
			return err
		}

		if len(req.PlanDigest) > 0 {
			statsDigests += 1
			digestRegistry.LinkPlan(hex.EncodeToString(req.PlanDigest), req.NormalizedPlan)
		}
	}

	zap.L().Info("TiDB Plan Meta Ingested",
		zap.Int("digests", statsDigests),
		zap.Duration("elapsed", time.Since(startTs)))
	resp := &tidbpb.EmptyResponse{}
	return stream.SendAndClose(resp)
}

func (s *tidbCollectServer) ReportCPUTimeRecords(stream tidbpb.TopSQLAgent_ReportCPUTimeRecordsServer) error {
	zap.L().Info("Receive TiDB Collect Stream")
	startTs := time.Now()

	statsDigests := 0
	sumDataPoints := 0
	for {
		req, err := stream.Recv()
		if err == io.EOF {
			break
		} else if err != nil {
			return err
		}

		err = data.IngestTiDBData(fmt.Sprintf("tidb-%d", s.port), req)
		if err != nil {
			zap.L().Warn("Ignored Stream Slice from TiDB", zap.Error(err))
			continue
		}
		statsDigests += 1
		sumDataPoints += len(req.TimestampList)
	}

	zap.L().Info("TiDB Stream Ingested",
		zap.Int("digests", statsDigests),
		zap.Int("dataPointsPerDigest", sumDataPoints / statsDigests),
		zap.Duration("elapsed", time.Since(startTs)))
	resp := &tidbpb.EmptyResponse{}
	return stream.SendAndClose(resp)
}

type tikvCollectServer struct {
	port int
}

func (s *tikvCollectServer) ReportCpuTime(stream tikvpb.ResourceUsageAgent_ReportCpuTimeServer) error {
	zap.L().Info("Receive TiKV Collect Stream")
	startTs := time.Now()

	statsDigests := 0
	sumDataPoints := 0
	for {
		req, err := stream.Recv()
		if err == io.EOF {
			break
		} else if err != nil {
			return err
		}
		err = data.IngestTiKVData(fmt.Sprintf("tikv-%d", s.port), req)
		if err != nil {
			zap.L().Warn("Ignored Stream Slice from TiKV", zap.Error(err))
			continue
		}
		statsDigests += 1
		sumDataPoints += len(req.RecordListCpuTimeMs)
	}

	zap.L().Info("TiKV Stream Ingested",
		zap.Int("digests", statsDigests),
		zap.Int("dataPointsPerDigest", sumDataPoints / statsDigests),
		zap.Duration("elapsed", time.Since(startTs)))
	resp := &tikvpb.ReportCpuTimeResponse{}
	return stream.SendAndClose(resp)
}

func startGrpcServer(l net.Listener, port int) error {
	grpcServer := grpc.NewServer()
	tidbpb.RegisterTopSQLAgentServer(grpcServer, &tidbCollectServer{port: port})
	tikvpb.RegisterResourceUsageAgentServer(grpcServer, &tikvCollectServer{port: port})
	return grpcServer.Serve(l)
}

func startHttpServer(l net.Listener) error {
	r := gin.New()

	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	r.Use(cors.New(config))

	r.Use(ginzap.Ginzap(zap.L(), time.RFC3339, true))
	r.Use(ginzap.RecoveryWithZap(zap.L(), true))

	r.GET("/digests/sql", func(c *gin.Context) {
		digestRegistry.Lock()
		c.JSON(http.StatusOK, digestRegistry.GetSQLMap())
		digestRegistry.Unlock()
	})

	r.GET("/series/all", func(c *gin.Context) {
		c.JSON(http.StatusOK, data.GetInstances())
	})

	r.GET("/series/by_instance/:instance", func(c *gin.Context) {
		instance := c.Param("instance")
		series := data.GetDataInInstance(instance)

		data.Lock()
		c.JSON(http.StatusOK, series)
		data.Unlock()
	})

	return r.RunListener(l)
}

func main() {
	logger, _ := zap.NewDevelopment()
	zap.ReplaceGlobals(logger)

	flag.Parse()

	grpcHost, grpcBasePortStr, err := net.SplitHostPort(*grpcListen)
	if err != nil {
		log.Fatalf("invalid gRPC service listen address (expect host:port)")
	}
	grpcBasePort, err := strconv.Atoi(grpcBasePortStr)
	if err != nil {
		log.Fatalf("invalid gRPC service port")
	}

	zap.L().Info("Starting gRPC services", zap.Int("numbers", *grpcServices))
	for i := 0; i < *grpcServices; i++ {
		listenAddr := fmt.Sprintf("%s:%d", grpcHost, grpcBasePort + i)
		grpcL, err := net.Listen("tcp", listenAddr)
		if err != nil {
			log.Fatalf("gRPC service failed to listen: %v", err)
		}
		zap.L().Info("gRPC service listening", zap.Int("serviceIndex", i),  zap.String("address", listenAddr))
		go startGrpcServer(grpcL, grpcBasePort + i)
	}

	apiL, err := net.Listen("tcp", *uiAPIListen)
	if err != nil {
		log.Fatalf("API service failed to listen: %v", err)
	}
	zap.L().Info("API service listening", zap.String("address", *uiAPIListen))
	startHttpServer(apiL)
}
