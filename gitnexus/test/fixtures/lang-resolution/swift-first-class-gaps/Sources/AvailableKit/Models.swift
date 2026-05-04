public struct User: Equatable {
  public var name: String

  public init(name: String = "") {
    self.name = name
  }

  public func save() {}
  public func selectedSave() {}
}

public struct Repo {
  public init() {}
  public func save() {}
}

public enum Event {
  case user(User)
  case repo(Repo)
}

public struct Vector {
  public init() {}

  public static func + (left: Vector, right: Vector) -> Vector {
    return left
  }
}

public enum Payload {
  case user(User)
  case empty
}

public protocol Storage {
  associatedtype Entity
  func store(_ entity: Entity)
}

public struct UserStorage: Storage {
  public init() {}
  public func store(_ entity: User) {}
}

public typealias UserStorageAlias = UserStorage

public extension UserStorage where Entity == User {
  func storeUser(_ entity: User) {
    store(entity)
  }
}

@dynamicMemberLookup
public struct DynamicUserBox {
  public init() {}

  public subscript(dynamicMember name: String) -> User {
    return User(name: name)
  }
}

@attached(member, names: named(macroSave), named(macroName))
public macro AutoUserMembers() = #externalMacro(module: "MacroImpl", type: "AutoUserMembers")

@AutoUserMembers
public struct MacroUser {
  public init() {}
}

public class CleanupOwner {
  public init() {}

  deinit {
    cleanup()
  }

  func cleanup() {}
}

public func selectedFactory() -> User {
  return User(name: "selected")
}

public func inactiveFactory() -> Repo {
  return Repo()
}
