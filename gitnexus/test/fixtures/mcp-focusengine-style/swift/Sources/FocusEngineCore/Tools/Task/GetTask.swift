import MCPToolkit

public struct GetTask: MCPTool, Sendable {
    public let name = "get_task"
    public let description: String? = "Get a single OmniFocus task by ID, returning full details"
    public var annotations: Tool.Annotations {
        Tool.Annotations(readOnlyHint: true)
    }

    public typealias Parameters = GetTaskParameters
}

