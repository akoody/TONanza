export const toJsonSafe = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, current) =>
      typeof current === "bigint" ? current.toString() : current
    )
  );
