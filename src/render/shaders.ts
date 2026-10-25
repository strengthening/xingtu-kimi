export const skyShaderDeclarations = /* glsl */ `
  uniform mat3 uWorldToView;
  uniform float uFovScale;
  uniform float uAspect;

  vec4 skyClipFromWorld(vec3 worldDirection) {
    vec3 viewDirection = normalize(uWorldToView * worldDirection);
    float denominator = max(1.0 - viewDirection.z, 0.00001);
    vec2 projected = 2.0 * viewDirection.xy / denominator;
    vec2 ndc = projected / (uFovScale * vec2(uAspect, 1.0));
    return vec4(ndc, 0.0, 1.0);
  }
`;

export const apparentStarFunction = /* glsl */ `
  uniform mat3 uEqjToWorld;
  uniform vec3 uEarthVelocity;
  uniform float uYearsSinceJ2000;

  vec3 apparentStarWorld(vec3 baseDirection, vec2 properMotion) {
    vec3 base = normalize(baseDirection);
    vec3 east = cross(vec3(0.0, 0.0, 1.0), base);
    east = length(east) < 0.0000001 ? vec3(1.0, 0.0, 0.0) : normalize(east);
    vec3 north = normalize(cross(base, east));
    vec3 natural = normalize(base + uYearsSinceJ2000 * (east * properMotion.x + north * properMotion.y));

    float speedSquared = dot(uEarthVelocity, uEarthVelocity);
    float inverseGamma = sqrt(max(0.0, 1.0 - speedSquared));
    float projection = dot(natural, uEarthVelocity);
    float velocityFactor = 1.0 + projection / (1.0 + inverseGamma);
    vec3 apparent = (natural * inverseGamma + uEarthVelocity * velocityFactor) / (1.0 + projection);
    return normalize(uEqjToWorld * apparent);
  }
`;

export const atmosphereFunction = /* glsl */ `
  uniform float uAtmosphere;

  float skyTransmission(float altitudeDegrees) {
    float altitude = clamp(altitudeDegrees, 0.0, 90.0);
    float airmass = clamp(
      1.0 / (sin(radians(altitude)) + 0.50572 * pow(altitude + 6.07995, -1.6364)),
      1.0,
      40.0
    );
    float opticalDepth = 0.28 * clamp(uAtmosphere, 0.0, 1.0) * airmass;
    float horizonFade = smoothstep(-0.5, 0.5, altitudeDegrees);
    return pow(10.0, -0.4 * opticalDepth) * horizonFade;
  }
`;
