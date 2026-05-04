public class PublicService {
    public init() {}

    public func doWork() {}
}

public func publicHelper() -> String {
    return "public"
}

func internalHelper() -> String {
    return "internal"
}

private func secretHelper() -> String {
    return "secret"
}

fileprivate func fileOnlyHelper() -> String {
    return "file"
}
