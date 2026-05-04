import AvailableKit

func patternFlow(pair: (User, Repo), iterator: AnyIterator<User>) {
  let (tupleUser, tupleRepo) = pair
  tupleUser.save()
  tupleRepo.save()

  switch pair {
  case let (switchedUser, switchedRepo):
    switchedUser.save()
    switchedRepo.save()
  }

  while let nextUser = iterator.next() {
    nextUser.save()
  }
}

func nonstandardCalls(left: Vector, right: Vector) {
  _ = left + right
  _ = Payload.user(User(name: "payload"))
  _ = CleanupOwner()
}

func runtimeDispatch(box: DynamicUserBox) {
  box.profile.save()

  let owner = SelectorOwner()
  owner.perform(#selector(SelectorOwner.selectedAction(_:)))
}

class SelectorOwner {
  @objc(selectedAction:)
  func selectedAction(_ sender: User) {
    sender.selectedSave()
  }

  func perform(_ selector: Selector) {}
}

func conditionalFlow() {
  #if canImport(AvailableKit)
  let selected = selectedFactory()
  selected.save()
  #else
  let inactive = inactiveFactory()
  inactive.save()
  #endif
}

func genericFlow(storage: UserStorage, alias: UserStorageAlias, user: User) {
  storage.storeUser(user)
  alias.storeUser(user)
}

func macroFlow(user: MacroUser) {
  user.macroSave()
}
