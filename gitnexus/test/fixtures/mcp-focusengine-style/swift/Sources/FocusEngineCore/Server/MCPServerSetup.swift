import MCP

func register(server: Server) async {
    await server.withMethodHandler(ListTools.self) { _ in
        let tools = [
            Tool(
                name: "weather",
                description: "Get current weather for a location",
                inputSchema: .object([:])
            )
        ]
        return .init(tools: tools)
    }
}

