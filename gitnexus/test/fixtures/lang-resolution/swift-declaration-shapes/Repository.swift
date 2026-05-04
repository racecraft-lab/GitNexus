protocol Repository {
    associatedtype Entity

    subscript(id: String) -> Entity { get }
}

actor Cache {
    func store() {}
}

func runCache() async {
    let cache = Cache()
    await cache.store()
}
