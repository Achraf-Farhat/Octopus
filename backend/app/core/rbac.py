ROLE_HIERARCHY = ["L1", "L2", "L3", "Manager", "Admin"]


def role_rank(role: str) -> int:
    try:
        return ROLE_HIERARCHY.index(role)
    except ValueError:
        return -1


def has_role_at_least(user_role: str, required_role: str) -> bool:
    return role_rank(user_role) >= role_rank(required_role)
