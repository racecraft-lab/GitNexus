class ImplicitLookupService {
    func find(_ raw: String) -> String {
        return "raw"
    }

    func find(id: String) -> String {
        return "id"
    }

    func runImplicit() -> String {
        return find("x")
    }
}
