import Any from '../types/any';
import finalizeType from '../parse/finalize-type';
import parseType from '../parse/parse-type';
import { pathToStr } from '../utils';
import { functionIsType} from '../types/basic';
import { arrayMethods, arrayVirtuals } from './array';
import { hydratePrototype, hydrateInstance } from './hydrate';

export default function parseObjectType(options, type, arrayType) {
  if (type === Object) return parseType(options, {});
  if (type === Array) return parseType(options, []);

  if (typeof type !== 'object') throw new TypeError(`${pathToStr(options.typeMoniker)} type must be an object`);

  arrayType = Boolean(arrayType);

  let self        = { options }
    , typeMoniker = options.typeMoniker
    , propNames   = Object.keys(type)
    , properties  = {}
    , virtuals    = {}
    , methods     = {}
    , meta        = {}
    , kind        = arrayType ? 'array' : 'object'
    , prototype
    , thisType
    , restType
    ;

  if (options.self) {
    self = Object.assign(options.self, self);
  }

  if (arrayType) {
    if (!type.length) {
      return parseType(options, Array);
    }

    if (type.length === 1) {
      restType = parseType({ ...options, parent: self, self: null, typeMoniker: typeMoniker.concat('*') }, type[0]);
      propNames = [];
      methods = { ...arrayMethods };
      virtuals = { ...arrayVirtuals };
    }
  } else {
    if (!propNames.length) {
      return parseType(options, Object);
    }

    if (propNames.indexOf('*') !== -1) {
      propNames.splice(propNames.indexOf('*'), 1);
      if (!propNames.length && type['*'] === Any) return parseType(options, Object);
      restType = parseType({ ...options, parent: self, self: null, typeMoniker: typeMoniker.concat('*') }, type['*']);
    }
  }

  propNames.forEach((prop) => {
    let descriptor = Object.getOwnPropertyDescriptor(type, prop);
    if (descriptor.get
      || descriptor.set
      || (typeof descriptor.value === 'function' && !functionIsType(descriptor.value))
    ) {
      if (descriptor.value) {
        methods[prop] = descriptor.value;
      } else {
        let virtual = {};
        if (descriptor.get) {
          virtual.get = descriptor.get;
        }
        if (descriptor.set) {
          virtual.set = descriptor.set;
        }
        virtuals[prop] = virtual;
      }
    } else {
      properties[prop] = parseType({
        ...options,
        parent: self,
        self: null,
        typeMoniker: typeMoniker.concat(prop)
      }, type[prop]);
      if (properties[prop].name === 'objectid' && !meta.idKey) {
        meta.idKey = prop;
      }
    }
  });

  thisType = {
    isType: true,
    name: pathToStr(typeMoniker) || arrayType ? 'array' : 'object',
    kind,
    storageKinds: [kind],
    options,
    validateData: function(value, instancePath) {
      instancePath = instancePath || typeMoniker;
      if (typeof value !== 'object') {
        return `Type of "${pathToStr(instancePath)}" data must be object`;
      }
      return (
        propNames.reduce((message, name) => message || properties[name].validateData(value[name], instancePath.concat(name)), null)
        || Object.keys(value).reduce((message, name) => {
          if (message) return message;
          if (restType) {
            if (propNames.indexOf(name) !== -1) return null;
            return restType.validateData(value[name], instancePath.concat(name));
          } else {
            if (propNames.indexOf(name) === -1) {
              return `Unknown data property "${pathToStr(instancePath.concat(name))}"`;
            }
          }
        }, null)
      );
    },
    validateAssign: function(value, instancePath) {
      instancePath = instancePath || typeMoniker;
      if (typeof value !== 'object') {
        return `Type of "${pathToStr(instancePath)}" must be object`;
      }
      instancePath = instancePath || typeMoniker;
      return (
        propNames.reduce((message, name) => message || properties[name].validateAssign(value[name], instancePath.concat(name)), null)
        || Object.keys(value).reduce((message, name) => {
          if (message) return message;
          if (restType) {
            if (propNames.indexOf(name) !== -1) return null;
            return restType.validateAssign(value[name], instancePath.concat(name));
          } else {
            if (propNames.indexOf(name) === -1) {
              return `Unknown property "${pathToStr(instancePath.concat(name))}"`;
            }
          }
        }, null)
      );
    },
    pack: function(value) {
      let out = arrayType ? [] : {};
      propNames.forEach(name => out[name] = properties[name].pack(value[name]));

      if (restType) {
        Object.keys(value).forEach((name) => {
          if (propNames.indexOf(name) === -1) {
            if ((isNaN(name) || ((Number(name) % 1) !== 0) || Number(name) < 0 || String(Number(name)) !== String(name))) {
              throw new TypeError(`Cannot set "${pathToStr(options.typeMoniker.concat(name))}" property on array`);
            }
            out[name] = restType.pack(value[name]);
          }
        });
      }
      return out;
    },
    unpack: function(store, storePath, instancePath, currentInstance, owner) {
      return hydrateInstance({
        ...options,
        prototype,
        store,
        storePath,
        instancePath,
        currentInstance,
        meta: { owner }
      });
    },
    defaultValue: function() {
      let defaultValue = arrayType ? [] : {};
      Object.keys(properties).forEach(name => defaultValue[name] = properties[name].defaultValue());
      return defaultValue;
    },
    properties,
    restType,
    methods,
    virtuals,
    defaultRestProp: function() {
      if (restType) return restType.defaultValue();
    },
    packProp: function(name, value) {
      if (propNames.indexOf(name) !== -1) {
        type = properties[name];
      } else {
        if (!restType) throw new TypeError(`Unknown property ${pathToStr(typeMoniker.concat(name))}`);
        type = restType;
      }
      return type.pack(value);
    }
  };

  if (arrayType) {
    thisType.length = type.length;
  }

  if ('name' in self) {
    delete thisType.name;
  }
  Object.assign(self, finalizeType(thisType));

  prototype = hydratePrototype({
    ...options,
    type: self,
    typePath: typeMoniker,
    getter(name) {
      let meta = this._meta
        , ix   = Number(name)
        , type
        ;

      if (arrayType) {
        if (isNaN(name) || ((ix % 1) !== 0) || ix < 0 || String(ix) !== String(name) || ix >= this.length) {
          return undefined;
        }
      }

      if (propNames.indexOf(name) !== -1) {
        type = properties[name];
      } else {
        if (!restType) {
          return;
        }
        type = restType;
        if (!name in this._meta.state) return;
      }
      return meta.store.unpack(type, meta.storePath.concat(name), meta.instancePath.concat(name), null, this);
    },
    setter(name, value) {
      let meta = this._meta
        , ix   = Number(name)
        , newState
        ;

      if (propNames.indexOf(name) !== -1) {
        type = properties[name];
      } else {
        if (!restType) throw new TypeError(`Unknown property ${pathToStr(meta.instancePath.concat(name))}`);
        type = restType;
      }

      if (arrayType) {
        if (isNaN(name) || ((ix % 1) !== 0) || ix < 0 || String(ix) !== String(name)) {
          throw new TypeError(`Cannot set "${pathToStr(options.typeMoniker.concat(name))}" property on array`);
        }
        newState = meta.store.get(meta.storePath);
        if (ix > this.length) {
          newState = newState.slice();
          while (ix > newState.length) {
            newState.push(type.defaultValue());
          }
          newState.push(type.pack(value));
          return meta.store.put(meta.storePath, newState);
        }
      }

      meta.store.put(meta.storePath.concat(name), type.pack(value));
    }, keys() {
      return Object.keys(this._meta.state);
    },
    properties,
    methods,
    virtuals,
    meta
  });

  self.prototype = prototype;

  return self;
}
