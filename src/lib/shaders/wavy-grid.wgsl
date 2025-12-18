struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

struct Uniforms {
    time: f32,
    aspect_ratio: f32,
    active_ripple_count: f32,
    viewport_height: f32,
    grid_color: vec3f,
    _padding2: f32,
    bg_color: vec3f,
    _padding3: f32,
}

struct RippleData {
    position: vec2f,
    strength: f32,
    startTime: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<uniform> ripples: array<RippleData, 128>;

const PI: f32 = 3.14159265359;
const GRID_CELL_SIZE: f32 = 24.0; // Match CSS grid-background: 24px
const LINE_WIDTH: f32 = 0.035;
const DISTORTION_SCALE: f32 = 0.016;
const LINE_BRIGHTNESS: f32 = 1.8;
const ANIMATION_SPEED: f32 = 0.12;
const RIPPLE_WAVELENGTH: f32 = 0.1;
const RIPPLE_SPEED: f32 = 0.08;
const RIPPLE_AMPLITUDE: f32 = 0.01;
const MAX_RIPPLE_RADIUS: f32 = 0.4;
const MIN_RIPPLE_RADIUS: f32 = 0.004;
const RIPPLE_EDGE_SHARPNESS: f32 = 1.0;

// Perlin noise implementation
fn permute(x: vec4f) -> vec4f {
    return ((x * 34.0 + 1.0) * x) % vec4f(289.0);
}

fn taylorInvSqrt(r: vec4f) -> vec4f {
    return 1.79284291400159 - 0.85373472095314 * r;
}

fn fade(t: vec3f) -> vec3f {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn perlin3d(P: vec3f) -> f32 {
    var Pi0 = floor(P);
    var Pi1 = Pi0 + vec3f(1.0);
    Pi0 = Pi0 % vec3f(289.0);
    Pi1 = Pi1 % vec3f(289.0);
    let Pf0 = fract(P);
    let Pf1 = Pf0 - vec3f(1.0);
    let ix = vec4f(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
    let iy = vec4f(Pi0.yy, Pi1.yy);
    let iz0 = Pi0.zzzz;
    let iz1 = Pi1.zzzz;

    let ixy = permute(permute(ix) + iy);
    let ixy0 = permute(ixy + iz0);
    let ixy1 = permute(ixy + iz1);

    var gx0 = ixy0 * (1.0 / 7.0);
    var gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
    gx0 = fract(gx0);
    var gz0 = vec4f(0.5) - abs(gx0) - abs(gy0);
    var sz0 = step(gz0, vec4f(0.0));
    gx0 = gx0 + sz0 * (step(vec4f(0.0), gx0) - 0.5);
    gy0 = gy0 + sz0 * (step(vec4f(0.0), gy0) - 0.5);

    var gx1 = ixy1 * (1.0 / 7.0);
    var gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
    gx1 = fract(gx1);
    var gz1 = vec4f(0.5) - abs(gx1) - abs(gy1);
    var sz1 = step(gz1, vec4f(0.0));
    gx1 = gx1 + sz1 * (step(vec4f(0.0), gx1) - 0.5);
    gy1 = gy1 + sz1 * (step(vec4f(0.0), gy1) - 0.5);

    var g000 = vec3f(gx0.x, gy0.x, gz0.x);
    var g100 = vec3f(gx0.y, gy0.y, gz0.y);
    var g010 = vec3f(gx0.z, gy0.z, gz0.z);
    var g110 = vec3f(gx0.w, gy0.w, gz0.w);
    var g001 = vec3f(gx1.x, gy1.x, gz1.x);
    var g101 = vec3f(gx1.y, gy1.y, gz1.y);
    var g011 = vec3f(gx1.z, gy1.z, gz1.z);
    var g111 = vec3f(gx1.w, gy1.w, gz1.w);

    let norm0 = taylorInvSqrt(vec4f(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
    g000 *= norm0.x;
    g010 *= norm0.y;
    g100 *= norm0.z;
    g110 *= norm0.w;
    let norm1 = taylorInvSqrt(vec4f(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
    g001 *= norm1.x;
    g011 *= norm1.y;
    g101 *= norm1.z;
    g111 *= norm1.w;

    let n000 = dot(g000, Pf0);
    let n100 = dot(g100, vec3f(Pf1.x, Pf0.yz));
    let n010 = dot(g010, vec3f(Pf0.x, Pf1.y, Pf0.z));
    let n110 = dot(g110, vec3f(Pf1.xy, Pf0.z));
    let n001 = dot(g001, vec3f(Pf0.xy, Pf1.z));
    let n101 = dot(g101, vec3f(Pf1.x, Pf0.y, Pf1.z));
    let n011 = dot(g011, vec3f(Pf0.x, Pf1.yz));
    let n111 = dot(g111, Pf1);

    let fade_xyz = fade(Pf0);
    let n_z = mix(vec4f(n000, n100, n010, n110), vec4f(n001, n101, n011, n111), fade_xyz.z);
    let n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
    let n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
    return 2.2 * n_xyz;
}

fn calculateRipple(uv: vec2f, ripple: RippleData) -> f32 {
    if (ripple.strength <= 0.0) {
        return 0.0;
    }

    let adjustedUV = vec2f(uv.x * uniforms.aspect_ratio, uv.y);
    let adjustedPosition = vec2f(ripple.position.x * uniforms.aspect_ratio, ripple.position.y);

    let dist = distance(adjustedUV, adjustedPosition);
    let age = uniforms.time - ripple.startTime;

    let targetRadius = age * RIPPLE_SPEED;
    let radius = min(targetRadius, MAX_RIPPLE_RADIUS);

    if (dist > radius + 0.1 || dist < MIN_RIPPLE_RADIUS) {
        return 0.0;
    }

    let normalizedDist = (dist - MIN_RIPPLE_RADIUS) / (radius - MIN_RIPPLE_RADIUS);
    let phase = (normalizedDist * 2.0 - age * 2.0) * PI;

    let edgeFalloff = 1.0 - smoothstep(radius * 0.7, radius, dist);
    let startFalloff = smoothstep(MIN_RIPPLE_RADIUS, MIN_RIPPLE_RADIUS * 2.0, dist);

    return sin(phase) *
           ripple.strength *
           RIPPLE_AMPLITUDE *
           edgeFalloff *
           startFalloff *
           exp(-dist * RIPPLE_EDGE_SHARPNESS);
}

fn calculateDistortions(uv: vec2f) -> vec2f {
    var noiseUV: vec2f;
    if (uniforms.aspect_ratio > 1.0) {
        noiseUV = vec2f(uv.x * uniforms.aspect_ratio, uv.y);
    } else {
        noiseUV = vec2f(uv.x, uv.y / uniforms.aspect_ratio);
    }

    let noise1 = perlin3d(vec3f(noiseUV.x * 12.0, noiseUV.y * 12.0, uniforms.time * ANIMATION_SPEED));
    let noise2 = perlin3d(vec3f(noiseUV.x * 12.0 + 100.0, noiseUV.y * 12.0 + 100.0, uniforms.time * ANIMATION_SPEED));

    var totalRippleDistortion: f32 = 0.0;
    let activeCount = min(u32(uniforms.active_ripple_count), 128u);
    for (var i = 0u; i < activeCount; i++) {
        let rippleEffect = calculateRipple(uv, ripples[i]);
        if (abs(rippleEffect) > 0.0001) {
            totalRippleDistortion += rippleEffect;
        }
    }

    return vec2f(noise1, noise2) * DISTORTION_SCALE + vec2f(totalRippleDistortion);
}

fn calculateGridIntensity(uv: vec2f, distortions: vec2f) -> f32 {
    var distortedUV = uv + distortions;

    // Calculate grid size to match CSS 24px cells
    let baseGridSize = uniforms.viewport_height / GRID_CELL_SIZE;

    var gridHorizontalSize: f32;
    var gridVerticalSize: f32;

    if (uniforms.aspect_ratio > 1.0) {
        gridHorizontalSize = baseGridSize * uniforms.aspect_ratio;
        gridVerticalSize = baseGridSize;
    } else {
        gridHorizontalSize = baseGridSize;
        gridVerticalSize = baseGridSize / uniforms.aspect_ratio;
    }

    var scaledUV = vec2f(
        distortedUV.x * gridHorizontalSize,
        distortedUV.y * gridVerticalSize
    );
    var gridUV = fract(scaledUV);

    var distToLine = min(
        min(gridUV.x, 1.0 - gridUV.x),
        min(gridUV.y, 1.0 - gridUV.y)
    );

    let rawIntensity = smoothstep(LINE_WIDTH, 0.0, distToLine);
    return clamp(rawIntensity * LINE_BRIGHTNESS, 0.0, 1.0);
}

@vertex
fn vertexMain(@location(0) position: vec2f) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4f(position, 0.0, 1.0);
    output.uv = position * 0.5 + 0.5;
    return output;
}

@fragment
fn fragmentMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let distortions = calculateDistortions(uv);
    let gridIntensity = calculateGridIntensity(uv, distortions);

    // Use theme colors from uniforms
    let finalColor = mix(uniforms.bg_color, uniforms.grid_color, gridIntensity);

    return vec4f(finalColor, 1.0);
}
