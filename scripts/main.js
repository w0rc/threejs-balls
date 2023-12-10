"use strict";

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

window.addEventListener( "DOMContentLoaded", ( ) => {
    /* --------Global-------- */
    // 情報表示用のDOMElement
    const dataViewer = document.getElementById( "dataViewer" );
    const dataViewer2 = document.getElementById( "dataViewer2" );
    const fpsViewer = document.getElementById( "fpsViewer" );
    // シミュレーション用の重力加速度ベクトル
    const GRAVITY = new THREE.Vector3( 0, -9.80665, 0 );
    // シミュレーションエリアのサイズ
    const AREA_SIZE = 256, AREA_HALF = AREA_SIZE / 2;
    // シミュレーション対象ボール数の初期値
    const BALLS_VOLUME = 32;
    // シミュレーション速度調整用の値
    const STEP_SCALE = 4;
    // その他のユーティリティメソッド
    const fixed = ( num, fractionDigits = 1 ) => {
        return Number.parseFloat( num ).toFixed( fractionDigits );
    };
    const toStringVector = ( v ) => {
        return [
            fixed( v.x ),
            fixed( v.y ),
            fixed( v.z )
        ].join();
    };
    /* --------Class-------- */
    /**
     * ランダム値を生成するクラス（XorShift）
     */
    class XorShift {
        static MAX = 0xffffffff;
        constructor ( seed = 88675123 ) {
            this.ite = this.generator( 123456789, 362436069, 521288629, seed >>> 0 );
            // for ( let i = 0, len = Math.floor( ( this.next() * 99 ) + 1 ); i < len; i++ ) this.next();
        }
        *generator ( x, y, z, w ) {
            for ( let t; ; ) {
                [t, x, y, z, w] = [x ^ ( x << 11 ), y, z, w, ( ( w ^ ( w >>> 19 ) ) ^ ( t ^ ( t >>> 8 ) ) ) >>> 0];
                yield w;
            }
        }
        next () {
            return this.ite.next().value / XorShift.MAX;
        }
        range ( min, max ) {
            return ( this.next() * ( max - min ) ) + min;
        }
    }
    const RANDOM = new XorShift( Date.now() );

    /**
     * リンクリストのノードクラス
     */
    class LinkedListNode {
        constructor ( value = null, prev = null, next = null ) {
            LinkedListNode.prototype.isLinkedListNode = true;
            this.value = value;
            this.prev = prev;
            this.next = next;
            this.list = null;
        }
    }
    /**
     * 双方向リンクリスト
     */
    class LinkedList {
        constructor ( ) {
            this.size = 0;
            const dummy = new LinkedListNode( );
            dummy.isDummy = true;
            dummy.prev = dummy;
            dummy.next = dummy;
            dummy.list = this;
            this.dummy = dummy;
        }
        head () {
            return this.dummy.next;
        }
        tail () {
            return this.dummy.prev;
        }
        insertAfter ( targetNode, insertValue ) {
            if ( !targetNode.isLinkedListNode ) return;
            const insertNode = insertValue.isLinkedListNode ?
                insertValue :
                new LinkedListNode( insertValue );
            insertNode.prev = targetNode;
            insertNode.next = targetNode.next;
            targetNode.next.prev = insertNode;
            targetNode.next = insertNode;
            insertNode.list = this;
            this.size++;
            return insertNode;
        }
        insertBefore ( targetNode, insertValue ) {
            if ( !targetNode.isLinkedListNode ) return;
            const insertNode = insertValue.isLinkedListNode ?
                insertValue :
                new LinkedListNode( insertValue );
            insertNode.prev = targetNode.prev;
            insertNode.next = targetNode;
            targetNode.prev.next = insertNode;
            targetNode.prev = insertNode;
            insertNode.list = this;
            this.size++;
            return insertNode;
        }
        delete ( targetNode ) {
            if ( targetNode.isDummy ) return;
            if ( !targetNode.isLinkedListNode ) return;
            targetNode.prev.next = targetNode.next;
            targetNode.next.prev = targetNode.prev;
            targetNode.next = null;
            targetNode.prev = null;
            targetNode.list = null;
            this.size--;
            return targetNode;
        }
        unshift ( insertValue ) {
            return this.insertAfter ( this.dummy, insertValue );
        }
        shift ( ) {
            return this.delete ( this.head() );
        }
        push ( insertValue ) {
            return this.insertBefore ( this.dummy, insertValue );
        }
        pop ( ) {
            return this.delete ( this.tail() );
        }
        toString ( separator = "," ) {
            const data = [];
            for ( let element = this.dummy.next;; ) {
                if ( element.isDummy ) break;
                data.push( element.value.uuid );
                element = element.next;
            }
            return data.join( separator );
        }
    }
    /**
     * ８分木空間を可視化するクラス
     * @extends THREE.Group
     */
    class OctreeBoxes extends THREE.Group {
        // シミュレーションエリアの分割レベルと分割数・分割後サイズ
        static DEVISION_LEVEL = 3;
        static DEVISIONS = 2 ** OctreeBoxes.DEVISION_LEVEL;
        static UNIT_LEN = AREA_SIZE / OctreeBoxes.DEVISIONS;
        // bit separator for division-level=3. (0 <= n <= 7)
        static bitSep = ( n ) => {
            let sep = n >>> 0;
            sep = ( sep | ( sep << 8 ) ) & 0x0000f00f;
            sep = ( sep | ( sep << 4 ) ) & 0x000c30c3;
            sep = ( sep | ( sep << 2 ) ) & 0x00249249;
            return sep;
        }
        static getMorton = ( vec ) => {
            return (
                OctreeBoxes.bitSep( vec.x ) << 0 | 
                OctreeBoxes.bitSep( vec.y ) << 1 | 
                OctreeBoxes.bitSep( vec.z ) << 2
            );
        };
        static getMortonIndex = ( object ) => {
            if ( object.isObject3D === false ) return;
            const AABBMin = object.position.clone().sub( object.scale )
                .addScalar( AREA_HALF ).divideScalar( OctreeBoxes.UNIT_LEN ).floor();
            const AABBMax = object.position.clone().add( object.scale )
                .addScalar( AREA_HALF ).divideScalar( OctreeBoxes.UNIT_LEN ).floor();
            const [min, max] = [OctreeBoxes.getMorton( AABBMin ), OctreeBoxes.getMorton( AABBMax )];
            let bit = min ^ max;
            let upperLevel = 0;
            while ( bit ) {
                bit = bit >> OctreeBoxes.DEVISION_LEVEL;
                upperLevel++;
            }
            const mortonNumber = min >>> ( OctreeBoxes.DEVISION_LEVEL * upperLevel );
            const belongLevel = OctreeBoxes.DEVISION_LEVEL - upperLevel;
            const mortonIndex = mortonNumber + 
                ( ( ( OctreeBoxes.DEVISIONS ** belongLevel ) - 1 ) / ( OctreeBoxes.DEVISIONS - 1 ) );
            return mortonIndex;
        }
        constructor ( ) {
            super();
            // ８分木分割空間ごとにユニット化する
            const boxBase = new THREE.Mesh(
                new THREE.BoxGeometry(
                    OctreeBoxes.UNIT_LEN,OctreeBoxes.UNIT_LEN,OctreeBoxes.UNIT_LEN,
                    4,4,4
                ),
                new THREE.MeshBasicMaterial( {
                    wireframe: true,
                    color: 0x333333,
                } )
            );
            boxBase.visible = false;
            // ８分木分割空間のユニット
            this.boxes = [];
            for ( let l = 0; l <= OctreeBoxes.DEVISION_LEVEL; l++ ) {
                const level = 2 ** l;
                const scale = OctreeBoxes.DEVISIONS / 2 ** l;
                const offset = OctreeBoxes.DEVISIONS / 2 ** ( l + 1 );
                for ( let i = 0; i < level; i++ ) {
                    for ( let j = 0; j < level; j++ ) {
                        for ( let k = 0; k < level; k++ ) {
                            const unit = boxBase.clone();
                            unit.position.set(
                                ( i * scale + offset ) * OctreeBoxes.UNIT_LEN - AREA_HALF,
                                ( j * scale + offset ) * OctreeBoxes.UNIT_LEN - AREA_HALF,
                                ( k * scale + offset ) * OctreeBoxes.UNIT_LEN - AREA_HALF
                            );
                            unit.scale.set( scale, scale, scale );
                            unit.geometry.computeBoundingBox();
                            unit.userData.bBox = new THREE.Box3( );
                            unit.userData.bBox.setFromObject( unit );
                            this.boxes[OctreeBoxes.getMortonIndex( unit )] = unit;
                            this.add( unit );
                        }
                    }
                }
            }
            // それぞれの８分木分割空間に所属するオブジェクトのリスト
            this.boxChildren = [];
            for ( let i = 0; i < this.boxes.length; i++ ) {
                this.boxChildren[i] = new LinkedList();
            }
        }
        update () {
            this.children.forEach( unit => {
                unit.visible = false;
            } );
        }
        visibleUnit ( target ) {
            if ( target.isObject3D ) {
                const targetIndex = OctreeBoxes.getMortonIndex( target );
                const unit = this.boxes[targetIndex];
                if ( unit ) {
                    unit.visible = true;
                }
            }
        }
    }
    /**
     * ボックスクラス。平面オブジェクトで構成される。
     * @extends THREE.Group
     */
    class PlaneBox extends THREE.Group {
        constructor ( size = AREA_SIZE, center = new THREE.Vector3( 0, 0, 0 )  ) {
            super();
            const size_half = size / 2;
            const planeNames = [
                "right","left","ceil","floor","front","back"
            ];
            // シミュレーション範囲限界とする平面オブジェクトの位置
            const planePositions = [
                new THREE.Vector3( size_half, 0, 0 ),  //right
                new THREE.Vector3( -size_half, 0, 0 ), //left
                new THREE.Vector3( 0, size_half, 0 ),  //ceil
                new THREE.Vector3( 0, -size_half, 0 ), //floor
                new THREE.Vector3( 0, 0, size_half ),  //front
                new THREE.Vector3( 0, 0, -size_half ), //back
            ];
            // 平面オブジェクトを作成・グループに追加
            const planeBase = new THREE.Mesh(
                new THREE.PlaneGeometry( size, size ),
                new THREE.MeshStandardMaterial( {
                    color: 0xffccff,
                    side: THREE.DoubleSide,
                    transparent: true, opacity: 0.1,
                } )
            );
            planeBase.receiveShadow = true;
            planePositions.forEach( ( position, index ) => {
                const plane = planeBase.clone();
                plane.position.copy( position );
                plane.lookAt( center );
                plane.geometry.computeBoundingBox();
                plane.userData.name = planeNames[index];
                plane.userData.bBox = new THREE.Box3().setFromObject( plane );
                plane.userData.normal = center.clone().sub( plane.position ).normalize();
                this.add( plane );
            } );
        }
    }
    /**
     * ボール
     * @extends THREE.Mesh
     */
    class Ball extends THREE.Mesh {
        // 反発係数
        static restitution = 0.96;
        // 摩擦係数
        static friction = 0.96;
        // デフォルトのスケール
        static defaultScale = 16;
        // ジオメトリとマテリアル
        static geometries = {
            default: new THREE.SphereGeometry( 1 ),
        };
        static materials = {
            default: new THREE.MeshStandardMaterial( {
                color: 0x333333, roughness: 0.6, metalness: 1.0, } ),
            selected: new THREE.MeshStandardMaterial( {
                color: 0xff0000, roughness: 0.4, metalness: 1.0, } ),
        };
        // ボールの階級（４～１６）
        static genRandomGrade = () => {
            return 4 * Math.floor( RANDOM.range( 1, 4 ) );
        };
        static genRandomColor = ( base = 0 ) => {
            // const color = Math.floor( Math.random() * 0xffffff );
            const r = Math.floor( RANDOM.range( base, 255 ) ) << 16;
            const g = Math.floor( RANDOM.range( base, 255 ) ) << 8;
            const b = Math.floor( RANDOM.range( base, 255 ) ) << 0;
            const color = r | g | b;
            return color;
        }
        constructor ( isGravityAffected = false ) {
            super(
                Ball.geometries.default,
                Ball.materials.default
            );
            Ball.prototype.isBall = true;
            // status
            this.enabled = true;
            this.grade = Ball.defaultScale;
            this.node = new LinkedListNode( this );
            // shadow
            this.castShadow = true;
            this.receiveShadow = true;
            // material
            this.originMaterial = this.material;
            // position
            this.position.set( 0, 0, 0 );
            // scale
            this.scale.set( this.grade,this.grade,this.grade );
            // boundingSphere
            this.geometry.computeBoundingSphere();
            this.bSphere = new THREE.Sphere( this.position );
            this.bSphere.radius = Math.floor( this.geometry.boundingSphere.radius * this.grade );
            // mass [kg]
            this.mass = this.grade;
            // accelaration [m/s^2]
            this.acceleration = new THREE.Vector3( );
            if ( isGravityAffected ) this.acceleration.copy( GRAVITY );
            // velocity [m/s]
            this.velocity = new THREE.Vector3( );
            // moved distance [m]
            this.moved = 0;
            this.oldPosition = this.position.clone();
            // 状態更新時の後処理
            this.postProcess();
        }
        randomize ( grade = Ball.genRandomGrade() ) {
            // status
            this.enabled = true;
            this.grade = grade;
            // material
            this.originMaterial = new THREE.MeshStandardMaterial( {
                // color: 0xffffff * RANDOM.next() / this.grade,
                color: Ball.genRandomColor( this.grade ),
                metalness: 0.8, roughness: 0.4,
            } );
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
            this.scale.set( this.grade, this.grade, this.grade );
            // boundingSphere
            this.geometry.computeBoundingSphere();
            this.bSphere = new THREE.Sphere( this.position );
            this.bSphere.radius = Math.floor( this.geometry.boundingSphere.radius * this.grade );
            // mass [kg]
            this.mass = this.grade;
            // velocity [m/s]
            const v0Scale = 30;
            this.velocity = new THREE.Vector3( 
                Math.floor( RANDOM.range( -v0Scale, v0Scale ) ),
                Math.floor( RANDOM.range( -v0Scale, v0Scale ) ),
                Math.floor( RANDOM.range( -v0Scale, v0Scale ) )
            );
            // moved distance [m]
            this.moved = 0;
            this.oldPosition = this.position.clone();
            // 状態更新時の後処理
            this.postProcess();
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
            this.postProcess();
        }
        /**
         *  @param {THREE.Mesh} plane
         */
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
            this.postProcess();
        }
        /**
         *  @param {Ball} other
         */
        collisionBall ( other ) {
            // 同一グレードのボールと衝突したとき
            if ( this.grade === other.grade ) {
                // 衝突したボールを無効化
                other.enabled = false;
                // グレードの半分を吸収
                this.grade += Math.floor( other.grade / 2 );
                if ( this.grade > AREA_HALF ) {
                    // 大きくなりすぎたら無効化
                    this.enabled = false;
                    return;
                }
                // this.material.roughness -= 0.1;
                this.scale.set( this.grade,this.grade,this.grade );
                this.geometry.computeBoundingSphere();
                this.bSphere = new THREE.Sphere( this.position );
                this.bSphere.radius = Math.floor( this.geometry.boundingSphere.radius * this.grade );
                this.mass = this.grade;
                // 状態更新時の後処理
                this.postProcess();
                return;
            }
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
            const h = ( this.bSphere.radius + other.bSphere.radius - p1p2.length() ) * 0.5;
            const c = p1p2.normalize();
            this.position.add( c.clone().multiplyScalar( h ) );
            other.position.add( c.clone().multiplyScalar( -h ) );
            // 衝突後の速度計算
            const v1v2 = this.velocity.clone().sub( other.velocity );
            const vConst = ( 1.0 + ( Ball.restitution * Ball.restitution ) ) / ( this.mass + other.mass ) * v1v2.dot( c );
            this.velocity.add( c.clone().multiplyScalar( -other.mass * vConst ) );
            other.velocity.add( c.clone().multiplyScalar( this.mass * vConst ) );
            // 状態更新時の後処理
            this.postProcess();
        }
        postProcess () {
            // moved distance
            this.moved += this.oldPosition.distanceTo( this.position );
            this.oldPosition = this.position.clone();
            // listing
            this.mortonIndex = OctreeBoxes.getMortonIndex( this );
        }
        select () {
            // ボールのマテリアルを選択状態に変更する
            this.material = Ball.materials.selected;
        }
        toString () {
            return this.uuid;
        }
        info ( separator = "<br />" ) {
            return [
                "Scale        :" + toStringVector( this.scale ),
                "Position     :" + toStringVector( this.position ),
                "Velocity     :" + toStringVector( this.velocity ),
                "Accelaration :" + toStringVector( this.acceleration ),
                "Moved        :" + fixed( this.moved ),
                "Morton       :" + this.mortonIndex
            ].join( separator );
        }
    }

    /* --------Scene-------- */
    const scene = new THREE.Scene();
    scene.background = new THREE.Color( 0xcccccc );
    // scene.add( new THREE.AxesHelper( AREA_SIZE ) );
    // console.info( scene );
    /* --------Camera-------- */
    const mainCam = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 5000 );
    mainCam.position.set( AREA_HALF, AREA_SIZE, AREA_HALF );
    // console.info( mainCam );
    /* --------Renderer-------- */
    const renderer = new THREE.WebGLRenderer();
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    document.body.appendChild( renderer.domElement );
    // console.info( renderer );
    /* --------OrbitControls-------- */
    const controls = new OrbitControls( mainCam, renderer.domElement );
    controls.enableDamping = true;
    // controls.autoRotate = true;
    /* --------Lights-------- */
    scene.add( new THREE.AmbientLight( 0xffffff, 0.3 ) );
    const spotLight = new THREE.SpotLight( 0xffffff, 128 );
    spotLight.angle = Math.PI / 4;
    spotLight.castShadow = true;
    spotLight.decay = 0.8;
    spotLight.position.set( 0, AREA_HALF, 0 );
    scene.add( spotLight );
    const spotLightTarget = new THREE.Object3D();
    spotLightTarget.position.set( 0, 0, 0 );
    spotLight.target = spotLightTarget;
    scene.add( spotLightTarget );
    // const spotLightHelper = new THREE.SpotLightHelper( spotLight, 10 );
    // scene.add( spotLightHelper );
    // console.info( spotLight );
    /* --------Simulation Area-------- */
    const simArea = new PlaneBox( );
    scene.add( simArea );
    // console.info( simArea );
    /* --------Visualize Morton Area-------- */
    const octreeBoxes = new OctreeBoxes();
    scene.add( octreeBoxes );
    // console.info( octreeUnits );
    /* --------Raycaster with Mouse Position-------- */
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const ballDropper = new THREE.Mesh(
        new THREE.SphereGeometry( 1 ),
        new THREE.MeshBasicMaterial( {
            color: 0xffcc99,
            transparent: true, opacity: 0.6,
        } )
    );
    ballDropper.userData.nextGrade = Ball.genRandomGrade();
    ballDropper.scale.set(
        ballDropper.userData.nextGrade,
        ballDropper.userData.nextGrade,
        ballDropper.userData.nextGrade
    );
    /* --------Objects-------- */
    const ballSet = new Set();
    for ( let i = 0; i < BALLS_VOLUME; i++ ) {
        const ball = new Ball( true );
        ball.randomize();
        ballSet.add( ball );
        scene.add( ball );
    }
    scene.add( ballDropper );
    /* --------Animation-------- */
    // アニメーション制御用のハンドラ
    const handler = {
        id : undefined,
        interval : Math.floor( 1000 / 60 ), // 60 FPS (16 [ms/frame])
        previousTimestamp : 0,
        step : ( 1 / 60 ) * STEP_SCALE,
        stepTime : 0,
    };
    // FPS計測用カウンタ
    const fpsCounter = {
        interval : 1000,
        timerStart : 0,
        previousFrames : 0,
    };
    const animate = ( timestamp ) => {
        /* --------アニメーション描画時間の制御-------- */
        if ( timestamp - handler.previousTimestamp < handler.interval ) {
            handler.id = window.requestAnimationFrame( animate );
            return;
        }
        handler.previousTimestamp = timestamp;
        handler.stepTime += handler.step;
        /* --------オブジェクトの更新-------- */
        // OrbitControlsの更新
        controls.update();
        // OctreeBoxesの更新
        octreeBoxes.update();
        // SpotLight関連の更新
        spotLightTarget.position.set(
            AREA_HALF / 4 * Math.cos( handler.stepTime / 4 ),
            0,
            AREA_HALF / 4 * Math.sin( handler.stepTime / 4 )
        );
        // spotLightHelper.update();
        /* --------ボール関連の更新-------- */
        ballSet.forEach( ball => {
            // 無効化状態のボールを削除
            if ( ball.enabled === false ) {
                if ( ball.node.list ) ball.node.list.delete( ball.node );
                ballSet.delete( ball );
                scene.remove( ball );
                ball.geometry.dispose();
                ball.material.dispose();
                return;
            }
            // ボールの状態を更新
            ball.update( handler.step );
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
            simArea.children.forEach( plane => {
                // todo ボールの速度が早いと突き抜ける。要修正。
                // if ( plane.userData.bBox.intersectsSphere( ball.bSphere ) ) {
                if ( ball.bSphere.intersectsPlane( plane.userData.bBox ) ) {
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
            // ボールの衝突判定用ツリーを更新
            const list = octreeBoxes.boxChildren[OctreeBoxes.getMortonIndex( ball )];
            if ( list ) {
                if ( ball.node.list ) ball.node.list.delete( ball.node );
                if ( ball.enabled ) list.push( ball.node );
            }
            // console.log( list );
        } );
        /* --------カーソルのレイキャストと交差するオブジェクト-------- */
        let intersectBalls = 0;
        ballDropper.material.visible = false;
        raycaster.intersectObjects( scene.children ).forEach( intersection => {
            if ( intersection.object.userData.name === "ceil" ) {
                ballDropper.material.visible = true;
                ballDropper.position.copy( intersection.point );
                ballDropper.position.setY( ballDropper.position.y + ballDropper.scale.y );
            }
            if ( intersection.object.isBall ) {
                if ( intersectBalls > 0 ) {
                    return;
                }
                intersectBalls++;
                dataViewer.innerHTML = intersection.object.info();
                intersection.object.select();
                octreeBoxes.visibleUnit( intersection.object );
            }
        } );
        /* --------オブジェクトの更新が終わったらレンダリング-------- */
        renderer.render( scene, mainCam );
        /* --------FPS計測-------- */
        if ( timestamp > fpsCounter.timerStart + fpsCounter.interval ) {
            // 前回計測時点からの経過時間
            const elapsed = timestamp - fpsCounter.timerStart;
            // インターバル時間で描画したフレーム
            const frames = renderer.info.render.frame - fpsCounter.previousFrames;
            // FPSとdeltaTimeを表示
            fpsViewer.innerHTML = [
                "fps:" + fixed( frames / elapsed * fpsCounter.interval ),
                "delta:" + fixed( elapsed / frames )
            ].join( "<br />" );
            // 次回計測のためカウントをリセット
            fpsCounter.timerStart = timestamp;
            fpsCounter.previousFrames = renderer.info.render.frame;

            // check
            let count = 0;
            const childrenInfo = [];
            octreeBoxes.boxChildren.forEach( ( list, i ) => {
                if ( list.size > 0 ) {
                    count += list.size;
                    childrenInfo.push( [
                        "index:" + i, list.toString( "<br />" )
                    ].join( "<br />" ) );
                }
            } );
            dataViewer2.innerHTML = [count, ...childrenInfo].join( "<br />" );
            // console.log( "count:" + count, ballSet.size );
        }
        /* --------次のアニメーションフレーム-------- */
        handler.id = requestAnimationFrame( animate );
    };
    animate( performance.now() );
    /* --------Events-------- */
    window.addEventListener( "mousemove", ( event ) => {
        mouse.setX( ( event.x / window.innerWidth ) * 2 - 1 );
        mouse.setY( -( event.y / window.innerHeight ) * 2 + 1 );
        raycaster.setFromCamera( mouse, mainCam );
    } );
    /*
    window.addEventListener( "click", ( ) => {
        if ( intersecTarget.material.visible ) {
            const ball = new Ball( true );
            ball.randomize();
            // const radius = ( AREA_HALF ) * Math.sqrt( RANDOM.next() );
            // const theta = RANDOM.range( -Math.PI, Math.PI );
            // ball.position.set(
            //     radius * Math.cos( theta ),
            //     AREA_HALF,
            //     radius * Math.sin( theta )
            // );
            ball.position.copy( intersecTarget.position );
            ball.position.setY( ball.position.y - ball.ballGrade );
            ball.velocity.set( 0, 0, 0 );
            ballSet.add( ball );
            scene.add( ball );
        }
    } );
    */
    window.addEventListener( "dblclick", ( event ) => {
        event.preventDefault();
        mouse.setX( ( event.x / window.innerWidth ) * 2 - 1 );
        mouse.setY( -( event.y / window.innerHeight ) * 2 + 1 );
        raycaster.setFromCamera( mouse, mainCam );
        raycaster.intersectObjects( scene.children ).forEach( e => {
            if ( e.object.isBall ) {
                e.object.enabled = false;
            }
        } );
    } );
    window.addEventListener( "keydown", ( event ) => {
        // event.preventDefault();
        if ( event.key === " " ) {
            if ( ballDropper.material.visible ) {
                const ball = new Ball( true );
                ball.randomize( ballDropper.userData.nextGrade );
                // const radius = ( AREA_HALF ) * Math.sqrt( RANDOM.next() );
                // const theta = RANDOM.range( -Math.PI, Math.PI );
                // ball.position.set(
                //     radius * Math.cos( theta ),
                //     AREA_HALF,
                //     radius * Math.sin( theta )
                // );
                ball.position.copy( ballDropper.position );
                ball.position.setY( AREA_HALF - ball.grade );
                ball.velocity.set( 0, 0, 0 );
                ballSet.add( ball );
                scene.add( ball );
                
                ballDropper.userData.nextGrade = Ball.genRandomGrade();
                ballDropper.scale.set(
                    ballDropper.userData.nextGrade,
                    ballDropper.userData.nextGrade,
                    ballDropper.userData.nextGrade
                );
            }
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
            // ボールを全て消去
            ballSet.forEach( ball => {
                ball.enabled = false;
            } );
        }
    } );
    // ウィンドウリサイズ時に表示を保持する
    window.addEventListener( "resize", ( ) => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        renderer.setPixelRatio( window.devicePixelRatio );
        renderer.setSize( width, height );
        mainCam.aspect = width / height;
        mainCam.updateProjectionMatrix();
    } );
} );
