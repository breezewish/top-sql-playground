# Top SQL Playground

## Start server

```shell
go run main.go
```

This will by default start multiple gRPC service endpoints so that you can point multiple TiDB instances to them.

## Start frontend

```shell
cd ui
yarn  # Install dependencies
yarn start
```

Note: This requires to have [Node.js](https://nodejs.org/en/) and [Yarn](https://classic.yarnpkg.com/en/docs/install#mac-stable) installed.

After starting the server, navigate to http://localhost:3000/
