import { Attribution } from "ox/erc8021";

export function getBuilderCodeDataSuffix(
  code = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE
) {
  const builderCode = code?.trim();
  if (!builderCode) return undefined;

  return Attribution.toDataSuffix({ codes: [builderCode] });
}
