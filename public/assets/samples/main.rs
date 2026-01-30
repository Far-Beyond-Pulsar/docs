pub mod engine_main;
pub mod classes;

fn main() {
    println!("Initializing Pulsar Engine...");
    
    // Initialize the engine backend
    engine_main::main();
    
    // Trigger initial blueprint events
    classes::ExampleClass::events::begin_play::begin_play();
    
    println!("Game started successfully!");
}
