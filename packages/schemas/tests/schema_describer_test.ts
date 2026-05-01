/**
 * @module SchemaDescriberTest
 * @path tests/schemas/schema_describer_test.ts
 * @description Verifies the utility for generating human-readable descriptions of
 * Zod schemas, ensuring accurate representation of tool parameters for agents.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { z } from "zod";
import { describeSchema } from "@exaix/schemas/schema_describer.ts";
import {
  SchemaDescriberEnumValue,
  SchemaDescriberKey,
  SchemaDescriberToken,
  SchemaDescriberType,
} from "@exaix/testing";

Deno.test("describeSchema: object fields are described", () => {
  const schema = z.object({
    [SchemaDescriberKey.Name]: z.string(),
    [SchemaDescriberKey.Age]: z.number().optional(),
    [SchemaDescriberKey.Tags]: z.array(z.string()),
    [SchemaDescriberKey.Status]: z.enum([
      SchemaDescriberEnumValue.Active,
      SchemaDescriberEnumValue.Inactive,
    ]),
  });

  const result = describeSchema(schema);

  const expectedNameField =
    `${SchemaDescriberToken.Quote}${SchemaDescriberKey.Name}${SchemaDescriberToken.Quote}${SchemaDescriberToken.FieldSeparator}${SchemaDescriberType.String}`;
  const expectedAgeField =
    `${SchemaDescriberToken.Quote}${SchemaDescriberKey.Age}${SchemaDescriberToken.Quote}${SchemaDescriberToken.FieldSeparator}${SchemaDescriberToken.OptionalPrefix}${SchemaDescriberType.Number}${SchemaDescriberToken.OptionalSuffix}`;
  const expectedTagsField =
    `${SchemaDescriberToken.Quote}${SchemaDescriberKey.Tags}${SchemaDescriberToken.Quote}${SchemaDescriberToken.FieldSeparator}${SchemaDescriberToken.ArrayPrefix}${SchemaDescriberType.String}${SchemaDescriberToken.ArraySuffix}`;
  const expectedEnumField =
    `${SchemaDescriberToken.Quote}${SchemaDescriberKey.Status}${SchemaDescriberToken.Quote}${SchemaDescriberToken.FieldSeparator}${SchemaDescriberToken.EnumPrefix}${
      [SchemaDescriberEnumValue.Active, SchemaDescriberEnumValue.Inactive].join(
        SchemaDescriberToken.EnumSeparator,
      )
    }${SchemaDescriberToken.EnumSuffix}`;

  assertStringIncludes(result, expectedNameField);
  assertStringIncludes(result, expectedAgeField);
  assertStringIncludes(result, expectedTagsField);
  assertStringIncludes(result, expectedEnumField);
});

Deno.test("describeSchema: arrays are described", () => {
  const result = describeSchema(z.array(z.string()));
  const expectedArray =
    `${SchemaDescriberToken.ArrayPrefix}${SchemaDescriberType.String}${SchemaDescriberToken.ArraySuffix}`;
  assertEquals(result, expectedArray);
});

Deno.test("describeSchema: unknown types fall back to unknown", () => {
  const result = describeSchema(z.any());
  assertEquals(result, SchemaDescriberType.Unknown);
});

Deno.test("describeSchema: primitives and optional are described", () => {
  assertEquals(describeSchema(z.string()), SchemaDescriberType.String);
  assertEquals(describeSchema(z.number()), SchemaDescriberType.Number);
  assertEquals(describeSchema(z.boolean()), SchemaDescriberType.Boolean);

  const optional = describeSchema(z.string().optional());
  assertStringIncludes(optional, SchemaDescriberToken.OptionalPrefix);
  assertStringIncludes(optional, SchemaDescriberType.String);
});

Deno.test("describeSchema: other Zod types fall back to unknown", () => {
  assertEquals(describeSchema(z.date()), SchemaDescriberType.Unknown);
});
