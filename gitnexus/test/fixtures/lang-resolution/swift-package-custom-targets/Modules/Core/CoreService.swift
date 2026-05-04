public class CoreService {
    public init() {}

    public func runCore() -> String {
        return "core"
    }
}

public func makeCoreService() -> CoreService {
    return CoreService()
}
