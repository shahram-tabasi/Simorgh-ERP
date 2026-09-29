# MinIO no longer publishes binaries or Docker images; it ships as source.
# This builds the same pinned version CI uses (.github/workflows/ci.yml).
FROM golang:1.24 AS build
ARG MINIO_VERSION=v0.0.0-20260212201848-7aac2a2c5b7c
RUN CGO_ENABLED=0 GOBIN=/out go install github.com/minio/minio@${MINIO_VERSION}

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/minio /usr/bin/minio
EXPOSE 9000 9001
ENTRYPOINT ["/usr/bin/minio"]
