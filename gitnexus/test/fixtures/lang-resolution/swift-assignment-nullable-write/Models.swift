final class Address {
    func save() {}
}

final class User {
    var name: String = ""
    var address: Address = Address()

    func save() {}
}

func makeUser() -> User {
    return User()
}

class BaseModel {
    func inheritedSave() {}
}

final class ChildModel: BaseModel {
    func processSuper() {
        super.inheritedSave()
    }
}

func processAliases() {
    let user = makeUser()
    let alias = user
    let second = alias

    alias.save()
    second.save()
    user.name = "Ada"
    user.address.save()
}

func processDirectChain() {
    makeUser().save()
}

func processOptional(maybeUser: User?) {
    maybeUser?.save()
}
