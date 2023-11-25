"use strict";

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

window.addEventListener( "DOMContentLoaded", ( ) => {
    /* --------Global-------- */
    // 情報表示用のDOMElement
    const dataViewer = document.getElementById( "dataViewer" );
    const fpsViewer = document.getElementById( "fpsViewer" );
    // シミュレーション用の重力加速度ベクトル
    const GRAVITY = new THREE.Vector3( 0, -9.80665, 0 );
    // シミュレーションエリアの原点とする中心座標
    const ORIGIN_POINT = new THREE.Vector3( 0, 0, 0 );
    // シミュレーションエリアのサイズ
    const AREA_SIZE = 256, AREA_HALF = AREA_SIZE / 2;
    // シミュレーションエリアの分割レベルと分割数・分割後サイズ
    const DEVISION_LEVEL = 3;
    const DEVISIONS = 2 ** DEVISION_LEVEL;
    const UNIT_LENGTH = AREA_SIZE / DEVISIONS;
    // シミュレーション対象ボール数の初期値
    const BALLS_VOLUME = 16;
    // シミュレーション速度調整用の値
    const STEP_SCALE = 4;
    // シミュレーション範囲限界とする平面オブジェクトの位置
    const planePositions = [
        new THREE.Vector3( AREA_HALF, 0, 0 ),  //right
        new THREE.Vector3( -AREA_HALF, 0, 0 ), //left
        new THREE.Vector3( 0, AREA_HALF, 0 ),  //ceil
        new THREE.Vector3( 0, -AREA_HALF, 0 ), //floor
        new THREE.Vector3( 0, 0, AREA_HALF ),  //front
        new THREE.Vector3( 0, 0, -AREA_HALF ), //back
    ];
    // bit separator for division-level=3. (0 <= n <= 7)
    const bitSep = ( n ) => {
        let sep = n >>> 0;
        sep = ( sep | ( sep << 8 ) ) & 0x0000f00f;
        sep = ( sep | ( sep << 4 ) ) & 0x000c30c3;
        sep = ( sep | ( sep << 2 ) ) & 0x00249249;
        return sep;
    }
    const getMorton = ( v ) => {
        return bitSep( v.x ) | ( bitSep( v.y ) << 1 ) | ( bitSep( v.z ) << 2 );
    };
    const getMortonIndex = ( a, b ) => {
        const [aMorton, bMorton] = [getMorton( a ), getMorton( b )];
        let bit = aMorton ^ bMorton;
        let upperLevel = 0;
        while ( bit ) {
            bit = bit >> DEVISION_LEVEL;
            upperLevel++;
        }
        const mortonNumber = aMorton >>> ( DEVISION_LEVEL * upperLevel );
        const belongLevel = DEVISION_LEVEL - upperLevel;
        const mortonIndex = mortonNumber + ( ( ( DEVISIONS ** belongLevel ) - 1 ) / ( DEVISIONS - 1 ) );
        return mortonIndex;
    }
    const fixed = ( num, fractionDigits = 1 ) => {
        return Number.parseFloat( num ).toFixed( fractionDigits );
    }
    const toStringVector = ( v ) => {
        return "[" + fixed( v.x ) + ", " + fixed( v.y ) + ", " + fixed( v.z ) + "]";
    }
    /* --------Class-------- */
    class XorShift {
        static MAX = 0xffffffff;
        constructor ( seed = 88675123 ) {
            this.iterator = this.generator( 123456789, 362436069, 521288629, seed >>> 0 );
            for ( let i = 0, len = Math.floor( ( this.next() * 99 ) + 1 ); i < len; i++ ) this.next();
        }
        *generator ( x, y, z, w ) {
            for ( let t; ; ) {
                [t, x, y, z, w] = [x ^ ( x << 11 ), y, z, w, ( ( w ^ ( w >>> 19 ) ) ^ ( t ^ ( t >>> 8 ) ) ) >>> 0];
                yield w;
            }
        }
        next () {
            return this.iterator.next().value / XorShift.MAX;
        }
        range ( min, max ) {
            return ( this.next() * ( max - min ) ) + min;
        }
    }
    const RANDOM = new XorShift( /* Date.now() */ );
    // ボールクラス
    class Ball extends THREE.Mesh {
        // 反発係数
        static restitution = 0.96;
        // 摩擦係数
        static friction = 0.96;
        // ジオメトリとマテリアル
        static geometries = {
            default: new THREE.SphereGeometry( 1 ),
        };
        static materials = {
            default: new THREE.MeshStandardMaterial( {
                color: 0x333333, roughness: 0.4, metalness: 0.8, } ),
            selected: new THREE.MeshStandardMaterial( {
                color: 0xff0000, roughness: 0.5, metalness: 1.0, } ),
        };
        constructor ( isGravityAffected = false ) {
            super(
                Ball.geometries.default,
                Ball.materials.default
            );
            Ball.prototype.isBall = true;
            this.castShadow = true;
            // material
            this.originMaterial = this.material;
            // position
            this.position.set( 0, 0, 0 );
            // scale
            const scale = 16;
            this.scale.set( scale, scale, scale );
            // boundingSphere
            this.geometry.computeBoundingSphere();
            this.bSphere = new THREE.Sphere( this.position );
            this.bSphere.radius = Math.floor( this.geometry.boundingSphere.radius * scale );
            // mass [kg]
            this.mass = scale;
            // accelaration [m/s^2]
            this.acceleration = new THREE.Vector3( );
            if ( isGravityAffected ) this.acceleration.copy( GRAVITY );
            // velocity [m/s]
            this.velocity = new THREE.Vector3( );
            // moved distance [m]
            this.moved = 0;
            this.beforePosition = this.position.clone();
            // 状態更新時の後処理
            this.updated();
        }
        randomize ( ) {
            // material
            this.originMaterial = new THREE.MeshStandardMaterial( {
                color: 0xffffff * RANDOM.next(), roughness: 0.4, metalness: 0.8, } );
            this.material = this.originMaterial;
            // position
            const [r, phi, theta] = [
                AREA_SIZE / 3 * RANDOM.next(),
                Math.asin( RANDOM.next() * 2 - 1 ),
                RANDOM.range( -Math.PI, Math.PI )
            ];
            const [sp, st, cp, ct] = [
                Math.sin( phi ), Math.sin( theta ), Math.cos( phi ), Math.cos( theta )
            ];
            this.position.set( r * cp * ct , r * cp * st, r * sp );
            // scale
            const scale = Math.floor( RANDOM.range( 6,12 ) );
            this.scale.set( scale, scale, scale );
            // boundingSphere
            this.geometry.computeBoundingSphere();
            this.bSphere = new THREE.Sphere( 
                this.position, 
                this.geometry.boundingSphere.radius * scale
            );
            // mass [kg]
            this.mass = scale;
            // velocity [m/s]
            const v0Scale = 30;
            this.velocity = new THREE.Vector3( 
                Math.floor( RANDOM.range( -v0Scale, v0Scale ) ),
                Math.floor( RANDOM.range( -v0Scale, v0Scale ) ),
                Math.floor( RANDOM.range( -v0Scale, v0Scale ) )
            );
            // moved distance [m]
            this.moved = 0;
            this.beforePosition = this.position.clone();
            // 状態更新時の後処理
            this.updated();
        }
        update ( step ) {
            // 速度の変化
            this.velocity.add( this.acceleration.clone().multiplyScalar( step ) );
            // 速度に応じて移動
            const move = this.velocity.clone().multiplyScalar( step );
            this.position.add( move );
            // 摩擦による減速
            if ( this.moved % 10 < 1 ) this.velocity.multiplyScalar( Ball.friction );
            // マテリアルを初期状態に戻す
            if ( this.originMaterial ) this.material = this.originMaterial;
            // 状態更新時の後処理
            this.updated();
        }
        collisionPlane ( plane ) {
            /*
                x1 as e(ball)'s param, x2 as o(plane)'s param, N as plane's Normal Vector
                correct position
                    h = Dot(p1-p2,N)
                    p1(after) = p1+N*(r-h), r is ball's radius
                calcurate velocity
                    vConst = -(1+e)*Dot(v1,N)
                    v1(after) = v1+N*vConst
            */
            // 衝突後の座標補正
            const h = this.position.clone().sub( plane.position ).dot( plane.userData.normal );
            this.position.add( plane.userData.normal.clone().multiplyScalar( this.bSphere.radius - h ) );
            // 衝突後の速度計算
            const vConst = -( 1 + Ball.restitution ) * this.velocity.dot( plane.userData.normal );
            this.velocity.add( plane.userData.normal.clone().multiplyScalar( vConst ) );
            // 状態更新時の後処理
            this.updated();
        }
        collisionBall ( other ) {
            /*
                x1 as this ball's param, x2 as other ball's param
                correct position 
                    p1p2 = p1 - p2
                    h = (e.radius + o.radius - p1p2.length) / 2
                    c = normalize(p1p2)
                    p1(after) = p1 + p1p2* h
                    p2(after) = p2 + p1p2*-h
                calcurate velocity
                    v1v2 = v1(before)-v2(before)
                    vConst = (1 + e1 * e2) / (m1 + m2) * Dot(v1v2,cNormal)
                    v1(after) = v1 - m2*vConst*c
                    v2(after) = v2 + m1*vConst*c
            */
            // 衝突後の座標補正
            const p1p2 = this.position.clone().sub( other.position );
            const h = ( this.bSphere.radius + other.bSphere.radius - p1p2.length() ) / 2;
            const c = p1p2.normalize();
            this.position.add( c.clone().multiplyScalar( h ) );
            other.position.add( c.clone().multiplyScalar( -h ) );
            // 衝突後の速度計算
            const v1v2 = this.velocity.clone().sub( other.velocity );
            const vConst = ( 1 + ( Ball.restitution * Ball.restitution ) ) / ( this.mass + other.mass ) * v1v2.dot( c );
            this.velocity.add( c.clone().multiplyScalar( -other.mass * vConst ) );
            other.velocity.add( c.clone().multiplyScalar( this.mass * vConst ) );
            // 状態更新時の後処理
            this.updated();
        }
        updated () {
            // morton index
            const AABBMin = this.position.clone()
                .sub( this.scale ).addScalar( AREA_HALF ).divideScalar( UNIT_LENGTH ).floor();
            const AABBMax = this.position.clone()
                .add( this.scale ).addScalar( AREA_HALF ).divideScalar( UNIT_LENGTH ).floor();
            this.mortonIndex = getMortonIndex( AABBMin, AABBMax );
            // moved distance
            this.moved += this.beforePosition.distanceTo( this.position );
            this.beforePosition = this.position.clone();
        }
        select () {
            this.material = Ball.materials.selected;
        }
        toString () {
            return (
                "Scale        :" + toStringVector( this.scale ) + "<br />" +
                "Position     :" + toStringVector( this.position ) + "<br />" +
                "Velocity     :" + toStringVector( this.velocity ) + "<br />" +
                "Accelaration :" + toStringVector( this.acceleration ) + "<br />" +
                "Morton(index):" + this.mortonIndex + "<br />" +
                "Moved        :" + fixed( this.moved ) + "<br />"
            );
        }
    }
    /* --------Renderer-------- */
    const renderer = new THREE.WebGLRenderer();
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize( window.innerWidth, window.innerHeight );
    document.body.appendChild( renderer.domElement );
    /* --------Scene-------- */
    const scene = new THREE.Scene();
    scene.add( new THREE.AxesHelper( AREA_SIZE ) );
    /* --------Camera-------- */
    const mainCam = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 5000 );
    mainCam.position.set( AREA_SIZE, AREA_SIZE * 0.2, AREA_SIZE );
    console.info( mainCam );
    /* --------OrbitControls-------- */
    const controls = new OrbitControls( mainCam, renderer.domElement );
    /* --------Lights-------- */
    scene.add( new THREE.AmbientLight( 0xffffff, 0.05 ) );
    const spotLight = new THREE.SpotLight( 0xffffff, 64 );
    spotLight.angle = Math.PI / 12;
    spotLight.castShadow = true;
    spotLight.decay = 0.8;
    spotLight.position.set( 0, AREA_SIZE, 0 );
    scene.add( spotLight );
    const spotLightTarget = new THREE.Object3D();
    spotLightTarget.position.set( 0, 0, 0 );
    spotLight.target = spotLightTarget;
    scene.add( spotLightTarget );
    console.info( spotLight );
    controls.enableDamping = true;
    /* --------Objects-------- */
    const ballSet = new Set();
    for ( let i = 0; i < BALLS_VOLUME; i++ ) {
        const ball = new Ball( );
        ball.randomize();
        ballSet.add( ball );
        scene.add( ball );
    }
    /* --------Planes-------- */
    const planes = [];
    const planeBase = new THREE.Mesh(
        new THREE.PlaneGeometry( AREA_SIZE, AREA_SIZE ),
        new THREE.MeshStandardMaterial( { color: 0xabedef, transparent: true, opacity: 0.8} )
    );
    planeBase.receiveShadow = true;
    planePositions.forEach( position => {
        const plane = planeBase.clone();
        plane.position.copy( position );
        plane.lookAt( ORIGIN_POINT );
        plane.geometry.computeBoundingBox();
        plane.userData.bBox = new THREE.Box3().setFromObject( plane );
        plane.userData.normal = ORIGIN_POINT.clone().sub( plane.position ).normalize();
        scene.add( plane );
        planes.push( plane );
    } );
    /* --------Visualize Morton Area-------- */
    const octreeUnits = [];
    const unitBase = new THREE.Mesh(
        new THREE.BoxGeometry(
            UNIT_LENGTH, UNIT_LENGTH, UNIT_LENGTH,
        ),
        new THREE.MeshBasicMaterial( {
            color: 0xcccccc,
            wireframe: true,
        } )
    );
    for ( let l = 0; l <= DEVISION_LEVEL; l++ ) {
        // level 0 to DEVESION_LEVEL
        const level = 2 ** l;
        const scale = DEVISIONS / 2 ** l;
        const offset = DEVISIONS / 2 ** ( l + 1 );
        for ( let i = 0; i < level; i++ ) {
            for ( let j = 0; j < level; j++ ) {
                for ( let k = 0; k < level; k++ ) {
                    const unit = unitBase.clone();
                    unit.position.set(
                        ( i * scale + offset ) * UNIT_LENGTH - AREA_HALF,
                        ( j * scale + offset ) * UNIT_LENGTH - AREA_HALF,
                        ( k * scale + offset ) * UNIT_LENGTH - AREA_HALF
                    );
                    unit.scale.set( scale, scale, scale );
                    unit.geometry.computeBoundingBox();
                    unit.userData.bBox = new THREE.Box3( );
                    unit.userData.bBox.setFromObject( unit );
                    const AABBMin = unit.position.clone().sub( unit.scale ).addScalar( AREA_HALF ).divideScalar( UNIT_LENGTH ).floor();
                    const AABBMax = unit.position.clone().add( unit.scale ).addScalar( AREA_HALF ).divideScalar( UNIT_LENGTH ).floor();
                    octreeUnits[getMortonIndex( AABBMin, AABBMax )] = unit;
                    scene.add( unit );
                }
            }
        }
    }
    /* --------Raycaster with Mouse Position-------- */
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    /* --------Animation-------- */
    const handler = {
        id : undefined,
        interval : Math.floor( 1000 / 60 ), // 60 FPS (16 [ms/frame])
        previousTimestamp : 0,
        stepTime : 0,
    };
    const fpsCounter = {
        interval: 1000,
        previousFrames : 0,
        timerStart : 0,
    }
    const animate = ( timestamp ) => {
        // インターバル時間未満でリクエストされた場合はスキップする
        if ( timestamp - handler.previousTimestamp < handler.interval ) {
            handler.id = window.requestAnimationFrame( animate );
            return;
        }
        // タイムスタンプをリセット
        handler.previousTimestamp = timestamp;
        // 単位時間 step [ms]のオブジェクト状態をシミュレーションする
        const step = handler.interval / 1000 * STEP_SCALE;
        handler.stepTime += step;
        // spotlight target update
        spotLightTarget.position.set(
            AREA_HALF / 2 * Math.cos( handler.stepTime / 3 ),
            0,
            AREA_HALF / 2 * Math.sin( handler.stepTime / 3 )
        );
        // console.log( toStringVector( spotLightTarget.position ) );
        // エリアの可視性を初期化
        octreeUnits.forEach( unit => {
            // const hasBall = Array.from( ballSet ).some( ball => unit.userData.bBox.intersectsSphere( ball.bSphere ) );
            // unit.visible = hasBall;
            unit.visible = false;
        } );
        // ボール関連の情報
        ballSet.forEach( ball => {
            // ボールの状態を更新
            ball.update( step );
            // ボールと壁面の衝突判定
            /*
            // 以下はボールの速度に関係なく押し戻せるが、実装としてはイマイチ
            if ( e.position.y < floor + e.scale.y ) {
                e.position.y = floor + e.scale.y;
                e.velocity.setY( -e.velocity.y * Ball.restitution );
            }
            if ( e.position.y > ceil - e.scale.y ) {
                e.position.y = ceil - e.scale.y;
                e.velocity.setY( -e.velocity.y * Ball.restitution );
            }
            if ( e.position.x < left + e.scale.x ) {
                e.position.x = left + e.scale.x;
                e.velocity.setX( -e.velocity.x * Ball.restitution );
            }
            if ( e.position.x > right - e.scale.x ) {
                e.position.x = right - e.scale.x;
                e.velocity.setX( -e.velocity.x * Ball.restitution );
            }
            if ( e.position.z < back + e.scale.z ) {
                e.position.z = back + e.scale.z;
                e.velocity.setZ( -e.velocity.z * Ball.restitution );
            }
            if ( e.position.z > front - e.scale.z ) {
                e.position.z = front - e.scale.z;
                e.velocity.setZ( -e.velocity.z * Ball.restitution );
            }
            */
            planes.forEach( plane => {
                // todo ボールの速度が早いと突き抜ける。要修正。
                if ( plane.userData.bBox.intersectsSphere( ball.bSphere ) ) {
                    ball.collisionPlane( plane );
                }
            } );
            // ボールとボールの衝突判定
            ballSet.forEach( other => {
                if ( ball === other ) return;
                if ( ball.bSphere.intersectsSphere( other.bSphere ) ) {
                    ball.collisionBall( other );
                }
            } );
            // ボールが存在するモートン順序エリアのユニットを可視化
            // const unit = units[ball.mortonIndex];
            // if ( unit ) {
            //     unit.visible = true;
            // }
        } );
        // マウスカーソルのレイキャストと交差するオブジェクトを特定する
        let intersectBalls = 0;
        raycaster.intersectObjects( scene.children ).forEach( intersection => {
            if ( intersection.object.isBall ) {
                if ( intersectBalls > 0 ) {
                    return;
                }
                const ball = intersection.object;
                ball.select();
                dataViewer.innerHTML = ball.toString();
                // ボールが存在するモートン順序エリアのユニットを可視化
                const unit = octreeUnits[ball.mortonIndex];
                if ( unit ) {
                    unit.visible = true;
                }
                intersectBalls++;
            }
        } );
        // OrbitControlsの更新
        controls.update();
        // オブジェクトの更新が終わったらレンダリング
        renderer.render( scene, mainCam );
        // FPSとdeltaTimeを計測
        if ( timestamp > fpsCounter.timerStart + fpsCounter.interval ) {
            // 前回計測時点からの経過時間
            const elapsed = timestamp - fpsCounter.timerStart;
            // インターバル時間で描画したフレーム
            const frames = renderer.info.render.frame - fpsCounter.previousFrames;
            // FPSとdeltaTimeを表示
            fpsViewer.innerHTML = (
                "fps:" + fixed( frames / elapsed * fpsCounter.interval ) + ", delta:" + fixed( elapsed / frames ) );
            // 次回計測のためカウントをリセット
            fpsCounter.timerStart = timestamp;
            fpsCounter.previousFrames = renderer.info.render.frame;
        }
        // 次のアニメーションフレーム
        handler.id = requestAnimationFrame( animate );
    };
    animate( performance.now() );
    /* --------Controls-------- */
    window.addEventListener( "mousemove", ( event ) => {
        mouse.setX( ( event.x / window.innerWidth ) * 2 - 1 );
        mouse.setY( -( event.y / window.innerHeight ) * 2 + 1 );
        raycaster.setFromCamera( mouse, mainCam );
    } );
    window.addEventListener( "dblclick", ( event ) => {
        event.preventDefault();
        mouse.setX( ( event.x / window.innerWidth ) * 2 - 1 );
        mouse.setY( -( event.y / window.innerHeight ) * 2 + 1 );
        raycaster.setFromCamera( mouse, mainCam );
        raycaster.intersectObjects( scene.children ).forEach( e => {
            if ( e.object.isBall ) {
                scene.remove( e.object );
                e.object.geometry.dispose();
                e.object.material.dispose();
                ballSet.delete( e.object );
            }
        } );
    } );
    window.addEventListener( "keydown", ( event ) => {
        // event.preventDefault();
        if ( event.key === " " ) {
            const ball = new Ball( );
            ball.randomize();
            ball.position.set( 0, 0, 0 );
            ballSet.add( ball );
            scene.add( ball );
        }
        if ( event.key === "Enter" ) {
            ballSet.forEach( ball => ball.randomize() );
        }
        if ( event.key === "p" ) {
            if ( !handler.id ) {
                handler.id = window.requestAnimationFrame( animate );
            } else {
                handler.id = window.cancelAnimationFrame( handler.id );
            }
        }
        if ( event.key === "x" ) {
            ballSet.forEach( ball => {
                scene.remove( ball );
                ball.geometry.dispose();
                ball.material.dispose();
            } );
            ballSet.clear();
        }
    } );
} );
