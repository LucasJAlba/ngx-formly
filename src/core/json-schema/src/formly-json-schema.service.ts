import { Injectable } from '@angular/core';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { JSONSchema7, JSONSchema7TypeName } from 'json-schema';
import { ɵreverseDeepMerge as reverseDeepMerge } from '@ngx-formly/core';
import { AbstractControl } from '@angular/forms';

export interface FormlyJsonschemaOptions {
  /**
   * allows to intercept the mapping, taking the already mapped
   * formly field and the original JSONSchema source from which it
   * was mapped.
   */
  map?: (mappedField: FormlyFieldConfig, mapSource: JSONSchema7) => FormlyFieldConfig;
}

function isEmpty(v) {
  return v === '' || v === undefined || v === null;
}

interface IOptions extends FormlyJsonschemaOptions {
  schema: JSONSchema7;
}

@Injectable({ providedIn: 'root' })
export class FormlyJsonschema {
  toFieldConfig(schema: JSONSchema7, options?: FormlyJsonschemaOptions): FormlyFieldConfig {
    return this._toFieldConfig(schema, { schema, ...(options || {}) });
  }

  private _toFieldConfig(schema: JSONSchema7, options: IOptions): FormlyFieldConfig {
    if (schema.$ref) {
      schema = this.resolveDefinition(schema, options);
    }

    if (schema.allOf) {
      schema = this.resolveAllOf(schema, options);
    }

    let field: FormlyFieldConfig = {
      type: this.guessType(schema),
      defaultValue: schema.default,
      templateOptions: {
        label: schema.title,
        readonly: schema.readOnly,
        description: schema.description,
      },
    };

    switch (field.type) {
      case 'number':
      case 'integer': {
        field.parsers = [v => isEmpty(v) ? null : Number(v)];
        if (schema.hasOwnProperty('minimum')) {
          field.templateOptions.min = schema.minimum;
        }

        if (schema.hasOwnProperty('maximum')) {
          field.templateOptions.max = schema.maximum;
        }

        if (schema.hasOwnProperty('exclusiveMinimum')) {
          this.addValidator(field, 'exclusiveMinimum', c => isEmpty(c.value) || (c.value > schema.exclusiveMinimum));
        }

        if (schema.hasOwnProperty('exclusiveMaximum')) {
          this.addValidator(field, 'exclusiveMaximum', c => isEmpty(c.value) || (c.value < schema.exclusiveMaximum));
        }

        if (schema.hasOwnProperty('multipleOf')) {
          field.templateOptions.step = schema.multipleOf;
          this.addValidator(field, 'multipleOf', c => isEmpty(c.value) || (c.value % schema.multipleOf === 0));
        }
        break;
      }
      case 'string': {
        ['minLength', 'maxLength', 'pattern'].forEach(prop => {
          if (schema.hasOwnProperty(prop)) {
            field.templateOptions[prop] = schema[prop];
          }
        });
        break;
      }
      case 'object': {
        field.fieldGroup = [];

        const [propDeps, schemaDeps] = this.resolveDependencies(schema);
        Object.keys(schema.properties || {}).forEach(key => {
          const f = this._toFieldConfig(<JSONSchema7> schema.properties[key], options);
          field.fieldGroup.push(f);
          f.key = key;
          if (Array.isArray(schema.required) && schema.required.indexOf(key) !== -1) {
            f.templateOptions.required = true;
          }
          if (!f.templateOptions.required && propDeps[key]) {
            f.expressionProperties = {
              'templateOptions.required': m => m && propDeps[key].some(k => !isEmpty(m[k])),
            };
          }

          if (schemaDeps[key]) {
            field.fieldGroup.push({
              ...this._toFieldConfig(schemaDeps[key], options),
              hideExpression: m => !m || isEmpty(m[key]),
            });
          }
        });
        break;
      }
      case 'array': {
        field.fieldGroup = [];
        Object.defineProperty(field, 'fieldArray', {
          get: () => {
            if (!Array.isArray(schema.items)) {
              // When items is a single schema, the additionalItems keyword is meaningless, and it should not be used.
              return this._toFieldConfig(<JSONSchema7> schema.items, options);
            }

            const itemSchema = schema.items[field.fieldGroup.length]
              ? schema.items[field.fieldGroup.length]
              : schema.additionalItems;

            return itemSchema
              ? this._toFieldConfig(<JSONSchema7> itemSchema, options)
              : null;
          },
          enumerable: true,
          configurable: true,
        });
        break;
      }
    }

    if (schema.enum) {
      field.type = 'enum';
      field.templateOptions.options = schema.enum.map(value => ({ value, label: value }));
    }

    // map in possible formlyConfig options from the widget property
    if (schema['widget'] && schema['widget'].formlyConfig) {
      field = reverseDeepMerge(schema['widget'].formlyConfig, field);
    }

    // if there is a map function passed in, use it to allow the user to
    // further customize how fields are being mapped
    return options.map ? options.map(field, schema) : field;
  }

  private resolveAllOf(schema: JSONSchema7, options: IOptions) {
    if (!schema.allOf.length) {
      throw Error(`allOf array can not be empty ${schema.allOf}.`);
    }
    return schema.allOf.reduce((prev: JSONSchema7, curr: JSONSchema7) => {
        if (curr.$ref) {
          curr = this.resolveDefinition(curr, options);
        }
        if (curr.allOf) {
          curr = this.resolveAllOf(curr, options);
        }
        return reverseDeepMerge(curr, prev);
      }, {});
  }

  private resolveDefinition(schema: JSONSchema7, options: IOptions): JSONSchema7 {
    const [uri, pointer] = schema.$ref.split('#/');
    if (uri) {
      throw Error(`Remote schemas for ${schema.$ref} not supported yet.`);
    }

    const definition = !pointer ? null : pointer.split('/').reduce(
      (def, path) => def && def.hasOwnProperty(path) ? def[path] : null,
      options.schema,
    );

    if (!definition) {
      throw Error(`Cannot find a definition for ${schema.$ref}.`);
    }

    if (definition.$ref) {
      return this.resolveDefinition(definition, options);
    }

    return {
      ...definition,
      ...['title', 'description', 'default'].reduce((annotation, p) => {
        if (schema.hasOwnProperty(p)) {
          annotation[p] = schema[p];
        }

        return annotation;
      }, {}),
    };
  }

  private resolveDependencies(schema: JSONSchema7) {
    const deps = {};
    const schemaDeps = {};

    Object.keys(schema.dependencies || {}).forEach(prop => {
      const dependency = schema.dependencies[prop] as JSONSchema7;
      if (Array.isArray(dependency)) {
        // Property dependencies
        dependency.forEach(dep => {
          if (!deps[dep]) {
            deps[dep] = [prop];
          } else {
            deps[dep].push(prop);
          }
        });
      } else {
        // schema dependencies
        schemaDeps[prop] = dependency;
      }
    });

    return [deps, schemaDeps];
  }

  private guessType(schema: JSONSchema7) {
    const type = schema.type as JSONSchema7TypeName;
    if (!type && schema.properties) {
      return 'object';
    }

    return type;
  }

  private addValidator(field: FormlyFieldConfig, name: string, validator: (control: AbstractControl) => boolean) {
    field.validators = field.validators || {};
    field.validators[name] = validator;
  }
}
